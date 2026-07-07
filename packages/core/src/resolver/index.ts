import { fetchAdemeCertificates, type AdemeCertificate } from "./ademe";
import { lookupParcel } from "./cadastre";
import { distanceM, geoDiskCoef, isPreciseMarker } from "./geo";
import { computeSelectivities, scoreCertificate, type ScoredCertificate } from "./scorer";
import type {
  MatchBreakdownItem,
  ResolveFlag,
  ResolvedAddress,
  ResolveStatus,
  ResolverInput,
} from "./types";

export type { ResolverInput, ResolvedAddress, MatchBreakdownItem } from "./types";

export interface ResolveAddressOptions {
  /** Nombre maximum de candidats retournés (défaut 5). */
  limit?: number;
  /** Activer le lookup cadastre pour le top-1 (défaut true). */
  withCadastre?: boolean;
  /** Injection fetch (tests). */
  fetchFn?: typeof fetch;
}

// ── Constantes paramétrables (calibration future) ──────────────────────────

/** Gate spatial serré pour un marqueur précis (m). */
const PRECISE_GATE_M = 30;
/**
 * Marqueur suspect « centré agence » : distance max marqueur ↔ agence géocodée.
 * Un portail qui épingle l'agence tombe à ~0-30 m de son géocodage BAN ; 75 m
 * absorbe le bruit de géocodage sans attraper les biens simplement proches de
 * l'agence (cas réel fondateur : Bien'ici 52457328, disque à ~1,9 km du bien).
 */
const AGENCY_MARKER_M = 75;
/** Distance au-delà de laquelle un marqueur « précis » est rétrogradé en disque. */
const MARKER_DEMOTE_M = 200;
/** Une adresse est « décidée » par le marqueur si elle est sous ce seuil… */
const GEO_DECIDE_M = 25;
/** …et isolée : la 2ᵉ adresse la plus proche est au-delà de ce seuil. */
const GEO_ISOLATED_M = 100;
/** Rayon par défaut d'un marqueur-disque sans rayon déclaré (m). */
const DISK_DEFAULT_R = 300;
/** Rayon « échelle parcelle » pour rattacher un lot à un DPE d'immeuble (m). */
const LOT_BUILDING_RADIUS = 80;
/** Empreinte DPE : fenêtre d'arrondi SeLoger sur la conso (kWh). */
const CONSO_EXACT = 0.5;
/** Empreinte DPE : le meilleur match doit se détacher du 2e d'au moins (kWh). */
const CONSO_GAP = 0.5;
/**
 * Empreinte DPE : la surface doit aussi coïncider — la conso seule ne suffit pas.
 * Tolérance RELATIVE (max de 3 m² et 5 %) : à 85 m², un écart de 3,6 m² (4 %)
 * est du bruit de mesure, pas un autre bien (cas réel vérifié : 87,6 ↔ 84,
 * conso ET GES exacts, rejeté pour 0,6 m² — parcellai.re le trouvait).
 */
const FP_SURFACE_TOL = 3;
const FP_SURFACE_PCT = 0.05;
/**
 * Empreinte GES : valeur minimale discriminante (kg CO₂/m²/an). Mesuré sur le
 * 40500 : sous ~15 (classes A/B, chauffage électrique), chaque valeur entière
 * est partagée par ~75 certificats de la commune → aucune sélectivité (2 faux
 * positifs corpus à GES 6 et 10). Au-dessus, ~10-13 certs/valeur et le test
 * d'unicité départage (cas Gambetta, GES 36 en double, correctement rejeté).
 */
const GES_FP_MIN = 15;

/** Marge top1/top2 pour un statut « confirmed ». */
const MARGIN_CONFIRM = 1.5;
/** Marge top1/top2 pour un statut « probable » (le top se détache). */
const MARGIN_PROBABLE = 1.2;
/** Accumulation : g_acc = min(base_top1 · k, cap) (façon min(score×3,10)). */
const ACC_K = 3;
const ACC_CAP = 10;
/** Pondération conf_attr = wAcc·acc + wMargin·marge. */
const W_ACC = 0.45;
const W_MARGIN = 0.55;

/**
 * Résout l'adresse réelle d'un bien — scoring par CROISEMENTS × sélectivité,
 * gate géo, puis confiance « accumulation + marge » accordée à la géo :
 *
 *   1. Requête ADEME (toute la commune, tous types).
 *   2. GATE spatial : un marqueur précis réduit le vivier aux certs proches
 *      (~30 m) ; un disque, à son rayon. Le marqueur s'auto-valide (rétrogradé
 *      si le plus proche est > 200 m).
 *   3. Scoring : base(c) = Σ_combos combo·sélectivité ; un marqueur-disque
 *      applique en plus un coefficient km-scale multiplicatif sur la base.
 *   4. Dédup par adresse (2 DPE d'un même bien = 1 adresse, le meilleur/récent).
 *   5. DÉCISION accordée géo↔attributs :
 *        – conf_attr = combinaison(accumulation, marge) entre adresses distinctes ;
 *        – conf_geo  = proximité + isolement du marqueur précis ;
 *        – statut ∈ {confirmed, probable, unresolved} selon marge, signal fort
 *          (combo rare OU géo précise corroborée) et absence de contradiction.
 *      Géo précise + DPE cohérent ⇒ HAUTE ; + DPE absent ⇒ probable ;
 *      + DPE contradictoire ⇒ conflit, jamais auto-résolu.
 *   6. Cadastre pour le top-1.
 *
 * ⚠️ Réplique manuelle dans `supabase/functions/resolve-address/index.ts`.
 */
export async function resolveAddress(
  rawInput: ResolverInput,
  opts: ResolveAddressOptions = {},
): Promise<ResolvedAddress[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 5;
  const withCadastre = opts.withCadastre ?? true;
  let input = sanitizeInput(rawInput);

  if (!input.postalCode) return [];

  // ── 1bis. Détecteur « marqueur centré agence » ───────────────────────────
  // Certains portails épinglent la carte sur l'ADRESSE DE L'AGENCE, pas sur le
  // bien (parfois à des kilomètres). Si le marqueur tombe sur l'agence
  // géocodée, la géo est un leurre : on l'ignore (les canaux attributaires —
  // empreintes conso/date — cherchent alors dans toute la commune) et on pose
  // un drapeau d'explicabilité.
  let agencyMarker = false;
  if (input.geo && input.agencyGeo) {
    const dAgency = distanceM(
      input.geo.lat,
      input.geo.lon,
      input.agencyGeo.lat,
      input.agencyGeo.lon,
    );
    if (dAgency <= AGENCY_MARKER_M) {
      agencyMarker = true;
      input = { ...input, geo: undefined };
    }
  }

  const certs = await fetchAdemeCertificates({ postalCode: input.postalCode, fetchFn });
  if (!certs.length) return [];

  // ── 2. Gate spatial ──────────────────────────────────────────────────────
  const dist = new Map<AdemeCertificate, number>();
  let precise = false;
  let pool = certs;
  let diskRadius = 0;
  if (input.geo) {
    const g = input.geo;
    for (const c of certs) {
      if (c.lat != null && c.lon != null) {
        dist.set(c, distanceM(g.lat, g.lon, c.lat, c.lon));
      }
    }
    const nearest = Math.min(...[...dist.values()], Infinity);
    precise = isPreciseMarker(g) && nearest <= MARKER_DEMOTE_M;
    diskRadius = g.radiusM ?? DISK_DEFAULT_R;
    const gateR = precise ? PRECISE_GATE_M : diskRadius;
    const gated = certs.filter((c) => (dist.get(c) ?? Infinity) <= gateR);
    if (gated.length) pool = gated; // sinon : marqueur inutilisable, on garde tout
  }

  // ── 3. Scoring (combos × sélectivité, + coef géo-disque) ─────────────────
  const selectivities = computeSelectivities(input, pool);
  const useDiskCoef = input.geo != null && !precise;
  const scored = pool.map((c) => {
    const s = scoreCertificate(input, c, selectivities);
    if (useDiskCoef) {
      const coef = geoDiskCoef(dist.get(c), diskRadius);
      s.score = round3(s.score * coef);
    }
    return s;
  });

  // ── 4. Dédup par adresse ─────────────────────────────────────────────────
  const addresses = groupByAddress(scored);

  // ── 5. Décision ──────────────────────────────────────────────────────────
  let ranked = decide(input, addresses, dist, precise, limit);

  // ── 5bis. Repli « empreinte DPE » (conso) ─────────────────────────────────
  // La conso est la vraie valeur du DPE (arrondie à l'entier par SeLoger). Si un
  // SEUL cert matche la conso à la précision d'arrondi (et se détache du 2e),
  // c'est LE certificat de l'annonce — même sans marqueur précis.
  if (ranked[0]?.status === "unresolved") {
    const fp = energyFingerprintCandidate(input, certs, dist, "conso");
    if (fp) ranked = promoteCandidates([fp], ranked, limit);
  }

  // ── 5bis-b. Repli « empreinte date DPE » ──────────────────────────────────
  // Date de diagnostic exacte unique dans la commune + ≥1 signal énergie
  // concordant — recherche HORS gate géo (marqueurs portail parfois faux).
  if (ranked[0]?.status === "unresolved") {
    const df = dpeDateFingerprintCandidate(input, certs, dist);
    if (df) ranked = promoteCandidates([df], ranked, limit);
  }

  // ── 5bis-c. Repli « empreinte GES » ───────────────────────────────────────
  // Quand la conso annoncée diffère du certificat (annonce ressaisie par
  // l'agence) mais que le GES colle exactement. Canal le plus faible des trois
  // (valeurs GES moins dispersées que la conso) → tenté en dernier, et
  // seulement sur une valeur discriminante (≥ GES_FP_MIN).
  if (ranked[0]?.status === "unresolved") {
    const gf = energyFingerprintCandidate(input, certs, dist, "ges");
    if (gf) ranked = promoteCandidates([gf], ranked, limit);
  }

  // ── 5bis-d. Corroboration d'empreinte sur un top « probable » ─────────────
  // Le scoring attributaire a tranché, et une empreinte (conso ou GES exacts,
  // uniques) désigne LA MÊME adresse : deux voies indépendantes concordent →
  // la confiance monte au niveau de l'empreinte (cas réel : Leboncoin
  // 3195763796, probable 78 % + GES 58 exact → 83 %). Une empreinte désignant
  // une AUTRE adresse ne rétrograde jamais le top (le scoring voit plus large).
  if (ranked[0]?.status === "probable") {
    const top = ranked[0];
    const fp =
      energyFingerprintCandidate(input, certs, dist, "conso") ??
      energyFingerprintCandidate(input, certs, dist, "ges");
    if (
      fp &&
      fp.address.trim().toLowerCase() === top.address.trim().toLowerCase() &&
      fp.confidence > top.confidence
    ) {
      ranked[0] = {
        ...top,
        confidence: fp.confidence,
        flags: [...new Set([...(top.flags ?? []), "dpe-fingerprint" as const])],
      };
    }
  }

  // ── 5ter. Repli « lot dans immeuble » ─────────────────────────────────────
  // Un appartement dont le lot n'a pas de DPE propre : on rattache le bien au
  // DPE d'IMMEUBLE concordant le plus proche. Statut « probable ». Exige un
  // marqueur PRÉCIS (sur un disque, la distance au centroïde n'a aucun sens).
  if (precise && ranked[0]?.status === "unresolved") {
    const lots = lotInBuildingCandidates(input, certs, dist, limit);
    if (lots.length) ranked = promoteCandidates(lots, ranked, limit);
  }

  // Trace du marqueur ignoré : l'UI peut expliquer « marqueur probablement
  // centré sur l'agence, localisation issue des attributs seuls ».
  if (agencyMarker) {
    for (const r of ranked) r.flags = [...(r.flags ?? []), "agency-marker-suspect"];
  }

  // ── 6. Cadastre top-1 ────────────────────────────────────────────────────
  if (withCadastre && ranked[0]) {
    const top = ranked[0];
    if (top.lat && top.lon) {
      try {
        const parcel = await lookupParcel({ lat: top.lat, lon: top.lon, fetchFn });
        top.parcelId = parcel?.id;
      } catch {
        // best-effort
      }
    }
  }

  return ranked;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Nettoie l'entrée : les portails renvoient des sentinelles à la place des
 * classes DPE/GES quand le diagnostic manque (« NS » = non soumis, « VI » =
 * vierge chez Bien'ici). Une classe hors A-G doit être traitée comme ABSENTE,
 * sinon elle ne matche jamais un certificat et produit un conflit systématique.
 * Idem pour les valeurs chiffrées ≤ 0.
 */
function sanitizeInput(i: ResolverInput): ResolverInput {
  const letter = (v?: string) =>
    v && /^[A-Ga-g]$/.test(v) ? (v.toUpperCase() as ResolverInput["dpeClass"]) : undefined;
  const pos = (v?: number) => (v != null && v > 0 ? v : undefined);
  return {
    ...i,
    dpeClass: letter(i.dpeClass),
    gesClass: letter(i.gesClass),
    dpeKwhM2: pos(i.dpeKwhM2),
    gesKgCO2M2: pos(i.gesKgCO2M2),
    surface: pos(i.surface),
    landSurface: pos(i.landSurface),
  };
}

/** Clé de regroupement d'adresse : identifiant BAN, sinon adresse normalisée. */
function addressKey(c: AdemeCertificate): string {
  if (c.addressId) return `ban:${c.addressId}`;
  return `addr:${c.address.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * Regroupe les certs par adresse ; garde par adresse le meilleur score (à
 * égalité, le DPE le plus récent). Deux DPE d'un même bien ne se concurrencent
 * pas.
 */
function groupByAddress(scored: ScoredCertificate[]): ScoredCertificate[] {
  const best = new Map<string, ScoredCertificate>();
  for (const s of scored) {
    const key = addressKey(s.cert);
    const cur = best.get(key);
    if (!cur || s.score > cur.score || (s.score === cur.score && newer(s.cert, cur.cert))) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

function newer(a: AdemeCertificate, b: AdemeCertificate): boolean {
  const ta = Date.parse(a.dpeDate ?? "");
  const tb = Date.parse(b.dpeDate ?? "");
  if (!Number.isFinite(ta)) return false;
  if (!Number.isFinite(tb)) return true;
  return ta > tb;
}

type Coherence = "concordant" | "absent" | "conflict";

/** Tolérances « cohérence » (≈ tolérance max des sim) pour les valeurs chiffrées. */
const COH_CONSO_TOL = 0.25;
const COH_GES_TOL = 0.35;
/**
 * Écart de surface au-delà duquel ce n'est plus le même logement.
 * 1,4× = 40 % d'écart : au-delà, la conso a beau coïncider, c'est un autre bien
 * (ex. annonce 90 m² matchée à tort sur un certificat 63 m² via la seule conso).
 * Couvre aussi l'échelle radicalement différente (immeuble entier ≠ lot).
 */
const SURFACE_CONFLICT_RATIO = 1.4;
/** Écart de classe GES (en lettres) au-delà duquel c'est un bien différent (A vs C). */
const GES_CONFLICT_STEPS = 2;

/** Distance en lettres entre deux classes DPE/GES (A..G → 0..6), ou null. */
function letterSteps(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const ia = "ABCDEFG".indexOf(a.toUpperCase());
  const ib = "ABCDEFG".indexOf(b.toUpperCase());
  if (ia < 0 || ib < 0) return null;
  return Math.abs(ia - ib);
}

function within(actual: number, target: number, tol: number): boolean {
  return Math.abs(actual - target) <= Math.abs(target) * tol;
}

/** Le type de bâtiment du cert est-il compatible avec l'annonce ? (appartement ⊆ immeuble) */
function typeCompatible(input: ResolverInput, cert: AdemeCertificate): boolean | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison";
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble";
}

/**
 * Le DPE de l'adresse corrobore-t-il l'annonce, la contredit-il, ou est-il
 * absent ? On compare la SIGNATURE ÉNERGÉTIQUE (DPE/GES, chiffre prioritaire
 * sinon lettre) directement au certificat — la surface n'entre PAS en compte
 * (deux logements voisins partagent souvent une surface proche sans être le même
 * bien). Un type de bâtiment contradictoire (maison↔appartement) tranche seul.
 *   – absent  : rien de comparable (cert sans DPE, ou annonce sans DPE) ;
 *   – conflict: type incompatible, écart de surface GROSSIER (immeuble ≠ lot),
 *     OU DPE/GES tous évaluables mais discordants ;
 *   – concordant : au moins un indicateur énergie concorde.
 *
 * La surface n'entre en compte QUE pour un écart grossier (> 2×) : un petit
 * écart (65 vs 63) est du bruit, mais un immeuble de 500 m² « confirmé » comme
 * un studio de 19 m² qui partage sa classe DPE est un faux positif.
 */
function coherence(input: ResolverInput, cert: AdemeCertificate): Coherence {
  // Type incompatible au point précis → ce n'est pas le bon bien.
  if (typeCompatible(input, cert) === false) return "conflict";
  // Échelle de bien radicalement différente (immeuble entier vs lot) → conflit.
  if (input.surface != null && cert.surface > 0) {
    const ratio = Math.max(input.surface, cert.surface) / Math.min(input.surface, cert.surface);
    if (ratio > SURFACE_CONFLICT_RATIO) return "conflict";
  }
  // GES qui contredit franchement (≥ 2 classes) → énergie différente = autre bien
  // (même conso mais GES A électrique vs GES C gaz = maisons distinctes).
  const gesSteps = letterSteps(input.gesClass, cert.gesClass);
  if (gesSteps != null && gesSteps >= GES_CONFLICT_STEPS) return "conflict";

  const signals: boolean[] = [];
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null) {
    signals.push(within(cert.dpeKwhM2, input.dpeKwhM2, COH_CONSO_TOL));
  } else if (input.dpeClass && cert.dpeClass) {
    signals.push(cert.dpeClass === input.dpeClass);
  }
  if (input.gesKgCO2M2 != null && cert.gesKgCO2M2 != null) {
    signals.push(within(cert.gesKgCO2M2, input.gesKgCO2M2, COH_GES_TOL));
  } else if (input.gesClass && cert.gesClass) {
    signals.push(cert.gesClass === input.gesClass);
  }

  if (!signals.length) return "absent";
  if (signals.some(Boolean)) return "concordant";
  return "conflict";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** DPE vérifié d'un candidat (classe + chiffres complets), sinon `undefined`. */
function toVerifiedDpe(c: AdemeCertificate): ResolvedAddress["verifiedDpe"] {
  if (!c.dpeClass || c.dpeKwhM2 == null || c.gesKgCO2M2 == null) return undefined;
  return {
    class: c.dpeClass,
    kwhM2: c.dpeKwhM2,
    gesKgCO2M2: c.gesKgCO2M2,
    surfaceM2: c.surface > 0 ? c.surface : undefined,
  };
}

// ── Repli « empreinte DPE » (conso OU GES exacts uniques) ───────────────────

/**
 * Empreinte DPE : la conso (kWh) — ou à défaut le GES (kg CO₂) — est la vraie
 * valeur du certificat, arrondie à l'entier par l'annonce. Si UN SEUL cert de
 * la commune (type/classe compatibles, surface plausible, dans le rayon géo)
 * matche cette valeur à la précision d'arrondi (±0.5) ET se détache nettement
 * du 2e, c'est le certificat de l'annonce. Le canal conso est tenté d'abord
 * (valeurs plus dispersées) ; le canal GES prend le relais quand la conso
 * annoncée diffère du certificat (annonce ressaisie/arrondie par l'agence —
 * cas réel : Leboncoin 3195763796, conso 301 vs 292,4 mais GES 58 exact).
 * Retourne ce candidat en « probable » (identité DPE quasi-certaine, mais sans
 * corroboration d'un marqueur précis), sinon `null`.
 */
function energyFingerprintCandidate(
  input: ResolverInput,
  certs: AdemeCertificate[],
  dist: Map<AdemeCertificate, number>,
  channel: "conso" | "ges",
): ResolvedAddress | null {
  const target = channel === "conso" ? input.dpeKwhM2 : input.gesKgCO2M2;
  if (target == null || input.surface == null) return null;
  // Une petite valeur GES n'identifie rien (cf. GES_FP_MIN).
  if (channel === "ges" && target < GES_FP_MIN) return null;
  const valueOf = (c: AdemeCertificate) =>
    channel === "conso" ? c.dpeKwhM2 : c.gesKgCO2M2;
  const radius = input.geo ? (input.geo.radiusM ?? DISK_DEFAULT_R) : Infinity;

  // Meilleur écart par ADRESSE (deux DPE d'un même bien ne concurrencent pas).
  const bestByAddr = new Map<string, { cert: AdemeCertificate; dVal: number }>();
  for (const c of certs) {
    const value = valueOf(c);
    if (value == null) continue;
    if (input.geo) {
      const d = dist.get(c);
      if (d == null || d > radius) continue;
    }
    if (typeCompatible(input, c) === false) continue;
    if (input.dpeClass && c.dpeClass && c.dpeClass !== input.dpeClass) continue;
    // La valeur seule ne fait pas une empreinte : surface ET classes doivent
    // corroborer (sinon deux logements partageant une valeur banale se confondent).
    if (Math.abs(c.surface - input.surface) > Math.max(FP_SURFACE_TOL, input.surface * FP_SURFACE_PCT)) continue;
    if (input.gesClass && c.gesClass && c.gesClass !== input.gesClass) continue;
    // Canal GES : la conso ne doit pas CONTREDIRE le certificat (écart ≤ 25 %) —
    // elle peut différer (ressaisie), mais pas désigner un autre logement.
    if (
      channel === "ges" &&
      input.dpeKwhM2 != null &&
      c.dpeKwhM2 != null &&
      !within(c.dpeKwhM2, input.dpeKwhM2, COH_CONSO_TOL)
    ) {
      continue;
    }
    const dVal = Math.abs(value - target);
    const key = addressKey(c);
    const cur = bestByAddr.get(key);
    if (!cur || dVal < cur.dVal) bestByAddr.set(key, { cert: c, dVal });
  }

  const ranked = [...bestByAddr.values()].sort((a, b) => a.dVal - b.dVal);
  const best = ranked[0];
  if (!best || best.dVal > CONSO_EXACT) return null; // pas de match exact
  if (ranked[1] && ranked[1].dVal - best.dVal < CONSO_GAP) return null; // pas unique

  const c = best.cert;
  const d = dist.get(c);
  // L'empreinte (valeur exacte + surface ±3 + unicité avec écart au 2e) vaut 76 ;
  // chaque corroboration optionnelle (classe de l'autre dimension concordante,
  // marqueur géo dans le rayon) renforce, plafonné à 85 (jamais « confirmed »
  // sans marqueur précis).
  let fpConf = 76;
  if (channel === "conso") {
    if (input.gesClass && c.gesClass && c.gesClass === input.gesClass) fpConf += 4;
  } else if (input.dpeClass && c.dpeClass && c.dpeClass === input.dpeClass) {
    fpConf += 4;
  }
  if (input.geo && d != null) fpConf += 3;
  fpConf = Math.min(fpConf, 85);
  const actual = valueOf(c);
  return {
    address: c.address,
    lat: c.lat ?? 0,
    lon: c.lon ?? 0,
    ademeCertId: c.certId,
    confidence: fpConf,
    status: "probable",
    resolved: false,
    distanceM: d != null ? Math.round(d) : undefined,
    flags: ["dpe-fingerprint"],
    matchBreakdown: [
      {
        criterion: channel === "conso" ? "empreinte-conso" : "empreinte-ges",
        matched: true,
        similarity: 1,
        expected: target,
        actual,
        factors: [
          {
            criterion: channel === "conso" ? "dpeKwhM2" : "gesKgCO2M2",
            similarity: 1,
            expected: target,
            actual,
          },
          { criterion: "surface", similarity: 1, expected: input.surface, actual: c.surface },
        ],
      },
    ],
    verifiedDpe: toVerifiedDpe(c),
  };
}

// ── Repli « empreinte date DPE » (date de diagnostic exacte unique) ─────────

/**
 * La date d'établissement du DPE publiée par l'annonce est une quasi-clé :
 * ~2 certificats par date dans une commune (mesuré : 40500, 761 dates, moyenne
 * 2,06). Si UNE SEULE adresse porte un cert à cette date exacte ET que rien ne
 * contredit (type, classe DPE, GES, échelle de surface ≤ 1,4×), c'est le
 * certificat de l'annonce — recherché dans TOUTE la commune, HORS gate géo :
 * les marqueurs portail sont parfois centrés ailleurs (cas réel vérifié en
 * console : disque de 500 m à 1,4 km du bien, Bien'ici 519553460).
 * La date seule ne suffit PAS (piège documenté : date → mauvaise maison) : on
 * exige au moins un signal ÉNERGIE concordant en plus (conso, classe ou GES).
 */
function dpeDateFingerprintCandidate(
  input: ResolverInput,
  certs: AdemeCertificate[],
  dist: Map<AdemeCertificate, number>,
): ResolvedAddress | null {
  if (!input.dpeDate) return null;

  const energySignals = (c: AdemeCertificate): number => {
    let n = 0;
    if (input.dpeKwhM2 != null && c.dpeKwhM2 != null && within(c.dpeKwhM2, input.dpeKwhM2, COH_CONSO_TOL)) n++;
    if (input.dpeClass && c.dpeClass && c.dpeClass === input.dpeClass) n++;
    if (
      (input.gesKgCO2M2 != null && c.gesKgCO2M2 != null && within(c.gesKgCO2M2, input.gesKgCO2M2, COH_GES_TOL)) ||
      (input.gesClass && c.gesClass && c.gesClass === input.gesClass)
    ) {
      n++;
    }
    return n;
  };

  // Tolérance « erreur d'étiquetage » : un type contradictoire n'élimine PAS si
  // la conso colle quasi exactement (± 5 %) — cas réel vérifié en console : cert
  // « appartement » de 205 m² (= la maison annoncée), date + conso + GES exacts,
  // seul le type divergeait (saisie du diagnostiqueur).
  const consoNearExact = (c: AdemeCertificate) =>
    input.dpeKwhM2 != null && c.dpeKwhM2 != null && within(c.dpeKwhM2, input.dpeKwhM2, 0.05);

  const bestByAddr = new Map<string, AdemeCertificate>();
  for (const c of certs) {
    if (!c.dpeDate || c.dpeDate !== input.dpeDate) continue;
    if (typeCompatible(input, c) === false && !consoNearExact(c)) continue;
    if (input.dpeClass && c.dpeClass && c.dpeClass !== input.dpeClass) continue;
    const gesSteps = letterSteps(input.gesClass, c.gesClass);
    if (gesSteps != null && gesSteps >= GES_CONFLICT_STEPS) continue;
    if (input.surface != null && c.surface > 0) {
      const ratio = Math.max(input.surface, c.surface) / Math.min(input.surface, c.surface);
      if (ratio > SURFACE_CONFLICT_RATIO) continue;
    }
    if (energySignals(c) < 1) continue; // la date seule ne fait pas une empreinte
    const key = addressKey(c);
    const cur = bestByAddr.get(key);
    if (!cur || newer(c, cur)) bestByAddr.set(key, c);
  }
  if (bestByAddr.size !== 1) return null; // plusieurs adresses à cette date → ambigu

  const c = [...bestByAddr.values()][0]!;
  const d = dist.get(c);
  // 76 base (date exacte unique + ≥1 signal énergie) ; +4 si ≥2 signaux ; +2 si
  // le cert est en plus dans le disque géo. Plafond 84 (jamais confirmed).
  const conf = Math.min(84, 76 + (energySignals(c) >= 2 ? 4 : 0) + (input.geo && d != null && d <= (input.geo.radiusM ?? DISK_DEFAULT_R) ? 2 : 0));
  return {
    address: c.address,
    lat: c.lat ?? 0,
    lon: c.lon ?? 0,
    ademeCertId: c.certId,
    confidence: conf,
    status: "probable",
    resolved: false,
    distanceM: d != null ? Math.round(d) : undefined,
    flags: ["dpe-date-fingerprint"],
    matchBreakdown: [
      {
        criterion: "empreinte-date",
        matched: true,
        similarity: 1,
        expected: input.dpeDate,
        actual: c.dpeDate,
        factors: [
          { criterion: "dpeDate", similarity: 1, expected: input.dpeDate, actual: c.dpeDate },
          { criterion: "dpeClass", similarity: 1, expected: input.dpeClass, actual: c.dpeClass },
        ],
      },
    ],
    verifiedDpe: toVerifiedDpe(c),
  };
}

// ── Repli « lot dans immeuble » ────────────────────────────────────────────

/** Le DPE d'un immeuble concorde-t-il avec l'annonce ? (chiffre prioritaire sinon lettre). */
function dpeMatch(input: ResolverInput, cert: AdemeCertificate): { ok: boolean; exact: boolean } {
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null) {
    return { ok: within(cert.dpeKwhM2, input.dpeKwhM2, COH_CONSO_TOL), exact: true };
  }
  if (input.dpeClass && cert.dpeClass) {
    return { ok: cert.dpeClass === input.dpeClass, exact: false };
  }
  return { ok: false, exact: false };
}

interface LotCand {
  cert: AdemeCertificate;
  d: number;
  exact: boolean;
  aptMatch: boolean;
  /** Écart |surface lot annoncée − surface moyenne d'un lot de l'immeuble| (m²). */
  lotFit: number;
}

/** Rang d'un candidat lot : nb de logements concordant > DPE chiffré exact > lettre. */
function rankLot(c: LotCand): number {
  return (c.aptMatch ? 2 : 0) + (c.exact ? 1 : 0);
}

/**
 * Le lot annoncé peut-il physiquement tenir dans cet immeuble ? Un immeuble à
 * ≥ 3 logements ne peut pas avoir un lot dépassant la moitié de sa surface
 * habitable totale (sinon ce ne sont pas des logements comparables).
 */
function lotFitsBuilding(input: ResolverInput, cert: AdemeCertificate): boolean {
  if (input.surface == null) return true;
  if (input.surface > cert.surface) return false; // lot plus grand que le bâtiment
  if (cert.apartmentCount != null && cert.apartmentCount >= 3 && input.surface > cert.surface / 2) {
    return false;
  }
  return true;
}

/**
 * Repli « lot dans immeuble » : pour un appartement/immeuble avec marqueur, si
 * aucun DPE de lot ne résout, on remonte les DPE d'IMMEUBLE concordants (même
 * classe/conso) à l'échelle parcelle (~80 m). La surface (lot vs bâtiment) est
 * ignorée — un lot de 69 m² vit dans un immeuble de 550 m². Départage : nb de
 * logements concordant > DPE chiffré exact > proximité.
 */
function lotInBuildingCandidates(
  input: ResolverInput,
  certs: AdemeCertificate[],
  dist: Map<AdemeCertificate, number>,
  limit: number,
): ResolvedAddress[] {
  if (!input.geo) return [];
  if (input.propertyType !== "Appartement" && input.propertyType !== "Immeuble") return [];

  // Si le marqueur est posé SUR un bâtiment (≤ GEO_DECIDE_M) dont la signature
  // CONTREDIT l'annonce, il désigne ce bâtiment-là : un repli à indice plus
  // faible (lettre DPE d'un immeuble voisin) n'a pas le droit d'aller résoudre
  // ailleurs. Cas réel vérifié en console : marqueur à 0 m du 4 Rue Porte
  // d'Aire (vraie adresse, DPE discordant), le repli proposait un immeuble
  // concordant à 60 m → fausse adresse à 84 %. Un bâtiment proche mais MUET
  // (cohérence absente) ne verrouille pas — cas Rozanoff, vérifié juste.
  let nearest: AdemeCertificate | undefined;
  let dNearest = Infinity;
  for (const c of certs) {
    const d = dist.get(c);
    if (d != null && d < dNearest) {
      dNearest = d;
      nearest = c;
    }
  }
  // …et seulement si ce bâtiment POURRAIT héberger le bien (type compatible) :
  // une MAISON discordante sous le marqueur d'un appartement (cas Rozanoff,
  // vérifié juste) n'interdit pas l'immeuble voisin — le bien n'y est pas.
  const pinnedKey =
    nearest &&
    dNearest <= GEO_DECIDE_M &&
    typeCompatible(input, nearest) !== false &&
    coherence(input, nearest) === "conflict"
      ? addressKey(nearest)
      : null;

  const cands: LotCand[] = [];
  for (const c of certs) {
    if (c.buildingType !== "immeuble") continue;
    const d = dist.get(c);
    if (d == null || d > LOT_BUILDING_RADIUS) continue;
    if (pinnedKey && addressKey(c) !== pinnedKey) continue; // le marqueur désigne un autre bâtiment
    const m = dpeMatch(input, c);
    if (!m.ok) continue;
    if (!lotFitsBuilding(input, c)) continue; // lot trop grand pour ce bâtiment
    const avgLot = c.apartmentCount ? c.surface / c.apartmentCount : null;
    cands.push({
      cert: c,
      d,
      exact: m.exact,
      aptMatch: input.apartmentCount != null && c.apartmentCount === input.apartmentCount,
      lotFit: avgLot != null && input.surface != null ? Math.abs(input.surface - avgLot) : Infinity,
    });
  }
  if (!cands.length) return [];

  // Ordre croissant = meilleur d'abord : nb logements > DPE exact > cohérence surface/lot > proximité.
  const cmpLot = (a: LotCand, b: LotCand) =>
    rankLot(b) - rankLot(a) || a.lotFit - b.lotFit || a.d - b.d;
  // Dédup par adresse (meilleur candidat de chaque immeuble).
  const best = new Map<string, LotCand>();
  for (const cand of cands) {
    const key = addressKey(cand.cert);
    const cur = best.get(key);
    if (!cur || cmpLot(cand, cur) < 0) best.set(key, cand);
  }
  const ordered = [...best.values()].sort(cmpLot);

  // Un SEUL immeuble concordant dans le rayon parcelle = signal décisif : le
  // marqueur précis a une erreur de l'ordre de 10-50 m, la distance exacte
  // n'apporte alors plus d'information (elle ne départage que des concurrents).
  const unique = best.size === 1;

  return ordered.slice(0, limit).map((cand) => {
    const c = cand.cert;
    const gesMatch = !!input.gesClass && !!c.gesClass && c.gesClass === input.gesClass;
    const bonus = (cand.exact ? 8 : 0) + (gesMatch ? 4 : 0) + (cand.aptMatch ? 6 : 0);
    const conf = unique
      ? Math.min(88, 76 + bonus)
      : // Plusieurs immeubles candidats : l'ambiguïté plafonne sous la barre de confiance.
        Math.max(45, Math.min(74, 55 + bonus - Math.round(cand.d / 10)));
    const breakdown: MatchBreakdownItem[] = [
      {
        criterion: "immeuble-dpe",
        matched: true,
        similarity: 1,
        factors: [
          {
            criterion: input.dpeKwhM2 != null ? "dpeKwhM2" : "dpeClass",
            similarity: 1,
            expected: input.dpeKwhM2 ?? input.dpeClass,
            actual: c.dpeKwhM2 ?? c.dpeClass,
          },
        ],
      },
      { criterion: "_geo", matched: cand.d <= LOT_BUILDING_RADIUS, distanceM: Math.round(cand.d) },
    ];
    return {
      address: c.address,
      lat: c.lat ?? 0,
      lon: c.lon ?? 0,
      ademeCertId: c.certId,
      confidence: conf,
      status: "probable",
      resolved: false,
      distanceM: Math.round(cand.d),
      flags: ["lot-in-building"],
      matchBreakdown: breakdown,
      verifiedDpe: toVerifiedDpe(c),
    };
  });
}

// NB (tenté puis retiré, 2026-07-02) : repli « résidence » — grappe de DPE
// d'appartements concordants à une même adresse dans le disque. Le cas réel qui
// le motivait (T1 40 m² C, 10 Av. du Marsan) s'est révélé être un MARQUEUR
// PORTAIL ERRONÉ (vraie adresse à ~1,9 km du disque, probablement centré sur
// l'agence) : aucun canal géographique ne peut le résoudre. Sur 65 annonces
// réelles, aucun cas positif ne déclenchait le canal → pas de preuve, pas de
// mise en prod. À re-tenter quand un cas réel avec marqueur FIABLE l'exigera.

/** Place les candidats de repli (probable) devant les non-résolus, dédup par adresse. */
function promoteCandidates(
  lots: ResolvedAddress[],
  ranked: ResolvedAddress[],
  limit: number,
): ResolvedAddress[] {
  const seen = new Set(lots.map((l) => l.address));
  const rest = ranked.filter((r) => !seen.has(r.address));
  return [...lots, ...rest].slice(0, limit);
}

interface Decision {
  status: ResolveStatus;
  confidence: number;
  flags: ResolveFlag[];
}

/**
 * Trie les adresses et calcule confiance/statut selon l'accord géo↔attributs.
 */
function decide(
  input: ResolverInput,
  addresses: ScoredCertificate[],
  dist: Map<AdemeCertificate, number>,
  precise: boolean,
  limit: number,
): ResolvedAddress[] {
  if (!addresses.length) return [];

  // NB (tenté puis retiré) : disqualifier les certs « conflict » avant la marge
  // fabrique des faux positifs — la marge, calculée sur le petit groupe restant,
  // explose et confirme des matchs faibles (attrapé par les négatifs du corpus).
  // Les certs contradictoires restent donc en lice comme garde-fous d'ambiguïté.

  // Référence attributaire : marge + accumulation entre adresses distinctes.
  const byScore = [...addresses].sort((a, b) => b.score - a.score);
  const score1 = byScore[0]!.score;
  const score2 = byScore[1]?.score ?? 0;
  const margin = score1 / Math.max(score2, 1e-6);
  const marginScore = clamp01(1 - 1 / margin); // 1.5→.33, 2→.5, 3→.67
  const acc = Math.min(score1 * ACC_K, ACC_CAP) / ACC_CAP; // accumulation 0–1
  const confAttr = clamp01(W_ACC * acc + W_MARGIN * marginScore);
  const strong = byScore[0]!.strongConcordant;

  let top = byScore[0]!;
  let decision: Decision;

  if (input.geo != null && precise) {
    // L'adresse est tranchée par le marqueur : on prend la plus proche.
    const byDist = [...addresses].sort(
      (a, b) => (dist.get(a.cert) ?? Infinity) - (dist.get(b.cert) ?? Infinity),
    );
    top = byDist[0]!;
    const d0 = dist.get(top.cert) ?? Infinity;
    const d1 = byDist[1] ? (dist.get(byDist[1].cert) ?? Infinity) : Infinity;
    const decided = d0 <= GEO_DECIDE_M && d1 > GEO_ISOLATED_M;
    const confGeo =
      clamp01(d0 < 15 ? 1 : d0 <= GEO_DECIDE_M ? 0.85 : 0.6) * (decided ? 1 : 0.7);
    decision = decidePreciseGeo(input, top, d0, confGeo, confAttr);
  } else {
    decision = decideAttributes(
      margin,
      strong,
      confAttr,
      coherence(input, top.cert),
      hardContradictions(top),
    );
  }

  // Construit la liste : top d'abord, puis le reste par score. Un candidat
  // alternatif ne peut pas afficher PLUS de confiance que le top retenu : sa
  // confiance est proportionnelle à son score relatif, plafonnée à celle du top.
  const rest = byScore.filter((s) => s !== top);
  const ordered = [top, ...rest].slice(0, limit);
  return ordered.map((s, i) => {
    if (i === 0) return toResolved(s, dist, input, decision);
    const conf =
      top.score > 0 ? Math.min(Math.round((s.score / top.score) * decision.confidence), decision.confidence) : 0;
    return toResolved(s, dist, input, { status: "unresolved", confidence: conf, flags: [] });
  });
}

/**
 * Décision quand un marqueur précis tranche l'adresse (accord géo↔DPE).
 * `d0` = distance du cert le plus proche au marqueur. Un cert hors du gate serré
 * (le marqueur ne tombe sur personne d'assez proche) ne peut PAS valoir HAUTE,
 * même cohérent : la géo ne corrobore alors aucune adresse.
 */
function decidePreciseGeo(
  input: ResolverInput,
  top: ScoredCertificate,
  d0: number,
  confGeo: number,
  confAttr: number,
): Decision {
  // NB (tenté puis retiré, 2026-07-03) : tolérer l'échelle « lot ⊂ immeuble
  // annoncé » quand le marqueur est posé sur le bâtiment (« 2 T2 vendus en
  // immeuble 83 m², cert du lot 39,6 m² à 3 m ») aurait CONFIRMÉ le n° 16…
  // alors que le vrai bien est au n° 18, à 6 m — îlot dense (16/14bis/18 en
  // ≤ 6 m), numéro indécidable par marqueur. L'abstention est la bonne réponse.
  const coh = coherence(input, top.cert);
  if (coh === "conflict") {
    // Jamais la géo n'écrase une contradiction DPE.
    return { status: "unresolved", confidence: Math.min(Math.round(confAttr * 100), 30), flags: ["conflict"] };
  }
  if (coh === "absent") {
    // Géo précise + DPE absent → probable (verifiedDpe restera null).
    return {
      status: "probable",
      confidence: Math.round(confGeo * 80),
      flags: ["geo-decided", "dpe-absent"],
    };
  }
  // DPE cohérent : HAUTE seulement si le cert est dans le gate serré ; sinon le
  // marqueur précis pointe entre les adresses connues → probable, pas confirmé.
  if (d0 <= GEO_DECIDE_M) {
    return {
      status: "confirmed",
      confidence: Math.max(85, Math.round(confGeo * 100)),
      flags: ["geo-corroborated", "dpe-confirmed"],
    };
  }
  return {
    status: "probable",
    confidence: Math.round(confGeo * 100),
    flags: ["geo-decided", "dpe-confirmed"],
  };
}

/**
 * Contradictions « dures » d'un candidat : facteurs dont la valeur est CONNUE
 * des deux côtés (annonce ET certificat) et franchement incompatible (sim 0).
 * Un cert peut matcher conso≈+surface par coïncidence dans le disque ; DEUX
 * attributs connus qui le contredisent = ce n'est pas le même bien. Cas réel
 * fondateur (Leboncoin 3222487629) : 163 → 158,3 kWh jugé « proche », mais
 * GES B↔A ET année 1975↔1900 → l'algo confirmait un faux positif à 79 %.
 */
function hardContradictions(s: ScoredCertificate): number {
  const seen = new Set<string>();
  for (const item of s.breakdown) {
    for (const f of item.factors ?? []) {
      if (f.expected != null && f.actual != null && f.similarity === 0) seen.add(f.criterion);
    }
  }
  return seen.size;
}

/** Décision sans marqueur précis : ce sont les attributs qui tranchent. */
function decideAttributes(
  margin: number,
  strong: number,
  confAttr: number,
  coh: Coherence,
  hardConflicts: number,
): Decision {
  const confidence = Math.round(confAttr * 100);
  if (coh === "conflict") {
    return { status: "unresolved", confidence: Math.min(confidence, 30), flags: ["conflict"] };
  }
  // Veto contradictions : ≥ 2 attributs connus incompatibles → autre bien,
  // quelle que soit la marge du score.
  if (hardConflicts >= 2) {
    return { status: "unresolved", confidence: Math.min(confidence, 40), flags: ["conflict"] };
  }
  if (margin >= MARGIN_CONFIRM && strong >= 1) {
    // « Confirmed » = on l'affiche comme vérifié : jamais sous 85.
    return { status: "confirmed", confidence: Math.max(85, confidence), flags: [] };
  }
  if (margin >= MARGIN_PROBABLE) {
    // Bande « probable » [70, 84] : la marge (≥ 1,2) et l'absence de conflit sont
    // déjà gatées — confAttr module la position dans la bande au lieu de
    // re-pénaliser une décision déjà prise (double comptage de l'incertitude).
    return { status: "probable", confidence: 70 + Math.round(confAttr * 14), flags: [] };
  }
  return { status: "unresolved", confidence, flags: ["low-margin"] };
}

function toResolved(
  s: ScoredCertificate,
  dist: Map<AdemeCertificate, number>,
  input: ResolverInput,
  decision?: Decision,
): ResolvedAddress {
  const c = s.cert;
  const d = dist.get(c);
  const status: ResolveStatus = decision?.status ?? "unresolved";
  // Ligne `_geo` : distance + coef pour rendre la combinaison reproductible.
  const breakdown = [...s.breakdown];
  if (input.geo != null && d != null) {
    breakdown.push({
      criterion: "_geo",
      matched: d <= GEO_DECIDE_M,
      distanceM: Math.round(d),
      geoCoef: round3(geoDiskCoef(d, input.geo.radiusM ?? DISK_DEFAULT_R)),
    });
  }
  return {
    address: c.address,
    lat: c.lat ?? 0,
    lon: c.lon ?? 0,
    ademeCertId: c.certId,
    confidence: decision?.confidence ?? Math.min(Math.round(s.score * 20), 100),
    status,
    resolved: status === "confirmed",
    distanceM: d != null ? Math.round(d) : undefined,
    flags: decision?.flags.length ? decision.flags : undefined,
    matchBreakdown: breakdown,
    verifiedDpe: toVerifiedDpe(c),
  };
}
