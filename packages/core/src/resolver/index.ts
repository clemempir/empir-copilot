import { fetchAdemeCertificates, type AdemeCertificate } from "./ademe";
import { lookupParcel } from "./cadastre";
import { distanceM, geoDiskCoef, isPreciseMarker } from "./geo";
import { computeSelectivities, scoreCertificate, type ScoredCertificate } from "./scorer";
import type { ResolveFlag, ResolvedAddress, ResolveStatus, ResolverInput } from "./types";

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
/** Distance au-delà de laquelle un marqueur « précis » est rétrogradé en disque. */
const MARKER_DEMOTE_M = 200;
/** Une adresse est « décidée » par le marqueur si elle est sous ce seuil… */
const GEO_DECIDE_M = 25;
/** …et isolée : la 2ᵉ adresse la plus proche est au-delà de ce seuil. */
const GEO_ISOLATED_M = 100;
/** Rayon par défaut d'un marqueur-disque sans rayon déclaré (m). */
const DISK_DEFAULT_R = 300;

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
  input: ResolverInput,
  opts: ResolveAddressOptions = {},
): Promise<ResolvedAddress[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 5;
  const withCadastre = opts.withCadastre ?? true;

  if (!input.postalCode) return [];

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
  const ranked = decide(input, addresses, dist, precise, limit);

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
 *   – conflict: type incompatible, OU DPE/GES tous évaluables mais discordants ;
 *   – concordant : au moins un indicateur énergie concorde.
 */
function coherence(input: ResolverInput, cert: AdemeCertificate): Coherence {
  // Type incompatible au point précis → ce n'est pas le bon bien.
  if (typeCompatible(input, cert) === false) return "conflict";

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
    decision = decideAttributes(margin, strong, confAttr, coherence(input, top.cert));
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

/** Décision sans marqueur précis : ce sont les attributs qui tranchent. */
function decideAttributes(
  margin: number,
  strong: number,
  confAttr: number,
  coh: Coherence,
): Decision {
  const confidence = Math.round(confAttr * 100);
  if (coh === "conflict") {
    return { status: "unresolved", confidence: Math.min(confidence, 30), flags: ["conflict"] };
  }
  if (margin >= MARGIN_CONFIRM && strong >= 1) {
    return { status: "confirmed", confidence, flags: [] };
  }
  if (margin >= MARGIN_PROBABLE) {
    return { status: "probable", confidence, flags: [] };
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
    verifiedDpe:
      c.dpeClass && c.dpeKwhM2 != null && c.gesKgCO2M2 != null
        ? { class: c.dpeClass, kwhM2: c.dpeKwhM2, gesKgCO2M2: c.gesKgCO2M2 }
        : undefined,
  };
}
