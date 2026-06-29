import { fetchAdemeCertificates, type AdemeCertificate } from "./ademe";
import { lookupParcel } from "./cadastre";
import { distanceM, isPreciseMarker } from "./geo";
import { computeSelectivities, scoreCertificate, type ScoredCertificate } from "./scorer";
import type { ResolveFlag, ResolvedAddress, ResolverInput } from "./types";

export type { ResolverInput, ResolvedAddress, MatchBreakdownItem } from "./types";

export interface ResolveAddressOptions {
  /** Nombre maximum de candidats retournés (défaut 5). */
  limit?: number;
  /** Activer le lookup cadastre pour le top-1 (défaut true). */
  withCadastre?: boolean;
  /** Injection fetch (tests). */
  fetchFn?: typeof fetch;
}

/** Gate spatial serré pour un marqueur précis (m). */
const PRECISE_GATE_M = 30;
/** Distance au-delà de laquelle un marqueur « précis » est rétrogradé en disque. */
const MARKER_DEMOTE_M = 200;
/** Une adresse est « décidée » par le marqueur si elle est sous ce seuil… */
const GEO_DECIDE_M = 25;
/** …et isolée : la 2ᵉ adresse la plus proche est au-delà de ce seuil. */
const GEO_ISOLATED_M = 100;
/** Marge d'attributs minimale pour considérer une adresse comme résolue. */
const MARGIN_RESOLVE = 1.5;

/**
 * Résout l'adresse réelle d'un bien — scoring adaptatif + logique
 * « gate-then-confirm » géo :
 *
 *   1. Requête ADEME (toute la commune, tous types).
 *   2. GATE spatial : si l'annonce porte un marqueur, on réduit le vivier aux
 *      certs proches (point précis ⇒ ~30 m ; disque ⇒ rayon). Le marqueur
 *      s'auto-valide : si le plus proche est > 200 m, il est rétrogradé.
 *   3. Scoring adaptatif (sélectivité locale) sur le vivier.
 *   4. Regroupement par adresse (2 DPE d'un même bien = 1 adresse).
 *   5. DÉCISION : on combine deux sous-confiances par ACCORD (jamais une somme) :
 *        – conf_geo  : proximité + isolement du marqueur ;
 *        – conf_attr : marge de score entre adresses (DPE).
 *      Marqueur précis isolé + DPE non contradictoire ⇒ confiance HAUTE et
 *      adresse « décidée » par le marqueur ; contradiction ⇒ plafonnée + flag
 *      `conflict` + `resolved:false`.
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
  if (input.geo) {
    const g = input.geo;
    for (const c of certs) {
      if (c.lat != null && c.lon != null) {
        dist.set(c, distanceM(g.lat, g.lon, c.lat, c.lon));
      }
    }
    const nearest = Math.min(...[...dist.values()], Infinity);
    precise = isPreciseMarker(g) && nearest <= MARKER_DEMOTE_M;
    const gateR = precise ? PRECISE_GATE_M : (g.radiusM ?? 300);
    const gated = certs.filter((c) => (dist.get(c) ?? Infinity) <= gateR);
    if (gated.length) pool = gated; // sinon : marqueur inutilisable, on garde tout
  }

  // ── 3. Scoring adaptatif ─────────────────────────────────────────────────
  const selectivities = computeSelectivities(input, pool);
  const scored = pool.map((c) => scoreCertificate(input, c, selectivities));

  // ── 4. Regroupement par adresse ──────────────────────────────────────────
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

/** Critères « identité » servant au contrôle de cohérence géo↔DPE. */
const COHERENCE_KEYS = new Set([
  "surface",
  "dpeKwhM2",
  "dpeClass",
  "gesKgCO2M2",
  "gesClass",
]);

type Coherence = "concordant" | "absent" | "conflict";

/** Le DPE de l'adresse corrobore-t-il l'annonce, la contredit-il, ou est-il absent ? */
function coherence(sc: ScoredCertificate): Coherence {
  const evaluable = sc.breakdown.filter(
    (b) => COHERENCE_KEYS.has(b.criterion) && b.similarity != null,
  );
  if (!evaluable.length) return "absent";
  if (evaluable.every((b) => (b.similarity ?? 0) < 0.2)) return "conflict";
  return "concordant";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Trie les adresses et calcule confiance/résolution selon l'accord géo↔attributs.
 */
function decide(
  input: ResolverInput,
  addresses: ScoredCertificate[],
  dist: Map<AdemeCertificate, number>,
  precise: boolean,
  limit: number,
): ResolvedAddress[] {
  if (!addresses.length) return [];

  // Tri par score d'attributs décroissant (référence pour conf_attr).
  const byScore = [...addresses].sort((a, b) => b.score - a.score);
  const score1 = byScore[0]!.score;
  const score2 = byScore[1]?.score ?? 0;
  const margin = score1 / Math.max(score2, 1e-6);
  const marginScore = clamp01(1 - 1 / margin); // 1.5→.33, 2→.5, 3→.67
  const confAttr = clamp01(0.6 * marginScore + 0.4 * clamp01(byScore[0]!.strongConcordant / 2));

  // Ordre final + désignation du top.
  let top = byScore[0]!;
  const flags: ResolveFlag[] = [];
  let confidence: number;
  let resolved: boolean;

  const usePreciseGeo = input.geo != null && precise;
  if (usePreciseGeo) {
    // L'adresse est tranchée par le marqueur : on prend la plus proche.
    const byDist = [...addresses].sort(
      (a, b) => (dist.get(a.cert) ?? Infinity) - (dist.get(b.cert) ?? Infinity),
    );
    top = byDist[0]!;
    const d0 = dist.get(top.cert) ?? Infinity;
    const d1 = byDist[1] ? (dist.get(byDist[1].cert) ?? Infinity) : Infinity;
    const decided = d0 <= GEO_DECIDE_M && d1 > GEO_ISOLATED_M;
    const confGeo = clamp01(d0 < 15 ? 1 : d0 <= GEO_DECIDE_M ? 0.85 : 0.6) * (decided ? 1 : 0.7);

    const coh = coherence(top);
    if (coh === "conflict") {
      flags.push("conflict");
      confidence = Math.min(Math.round(confAttr * 100), 30);
      resolved = false;
    } else if (coh === "absent") {
      flags.push("geo-decided", "dpe-absent");
      confidence = Math.round(confGeo * 85); // moyenne-haute : la géo porte
      resolved = confGeo >= 0.7;
    } else {
      flags.push("geo-decided", "dpe-confirmed");
      confidence = Math.max(85, Math.round(confGeo * 100));
      resolved = true;
    }
  } else {
    // Pas de marqueur précis : ce sont les attributs qui tranchent.
    if (margin < MARGIN_RESOLVE) flags.push("low-margin");
    confidence = Math.round(confAttr * 100);
    resolved = margin >= MARGIN_RESOLVE && byScore[0]!.strongConcordant >= 1;
  }

  // Construit la liste : top d'abord, puis le reste par score.
  const rest = byScore.filter((s) => s !== top);
  const ordered = [top, ...rest].slice(0, limit);

  return ordered.map((s, i) =>
    toResolved(s, dist, i === 0 ? { confidence, resolved, flags } : undefined),
  );
}

function toResolved(
  s: ScoredCertificate,
  dist: Map<AdemeCertificate, number>,
  topDecision?: { confidence: number; resolved: boolean; flags: ResolveFlag[] },
): ResolvedAddress {
  const c = s.cert;
  const d = dist.get(c);
  return {
    address: c.address,
    lat: c.lat ?? 0,
    lon: c.lon ?? 0,
    ademeCertId: c.certId,
    confidence: topDecision?.confidence ?? Math.min(Math.round(s.score * 20), 100),
    resolved: topDecision?.resolved ?? false,
    distanceM: d != null ? Math.round(d) : undefined,
    flags: topDecision?.flags?.length ? topDecision.flags : undefined,
    matchBreakdown: s.breakdown.map((b) =>
      d != null && b.criterion === "_geo" ? { ...b, distanceM: Math.round(d) } : b,
    ),
    verifiedDpe:
      c.dpeClass && c.dpeKwhM2 != null && c.gesKgCO2M2 != null
        ? { class: c.dpeClass, kwhM2: c.dpeKwhM2, gesKgCO2M2: c.gesKgCO2M2 }
        : undefined,
  };
}
