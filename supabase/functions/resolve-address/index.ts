/**
 * resolve-address — résolution d'adresse à la manière de parcellai.re.
 *
 * POST { deviceHash, listingUrl, input: ResolverInput }
 *
 * Pipeline :
 *   1. Délègue à track-usage pour appliquer le quota
 *   2. Cache (table address_cache)
 *   3. Requête ADEME + scoring ADAPTATIF + gate géo + cadastre
 *      (logique RÉPLIQUE de packages/core/src/resolver — gardée synchronisée à
 *      la main, l'import d'un workspace package depuis une Edge Function n'est
 *      pas trivial). Si tu modifies l'algo, propage dans les deux sens.
 *
 * Renvoie : { candidates: ResolvedAddress[], usage, debug }
 */
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type DpeLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

interface GeoHint {
  lat: number;
  lon: number;
  radiusM?: number;
  precision?: "gps" | "disk";
  /** Marqueur GPS exploitable comme gate serré (prioritaire sur precision/radiusM). */
  precise?: boolean;
}

interface ResolverInput {
  postalCode: string;
  city?: string;
  surface?: number;
  rooms?: number;
  yearBuilt?: number;
  dpeClass?: DpeLetter;
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
  gesClass?: DpeLetter;
  landSurface?: number;
  dpeDate?: string;
  apartmentCount?: number;
  propertyType?: "Appartement" | "Maison" | "Immeuble";
  geo?: GeoHint;
}

type ResolveFlag =
  | "geo-decided"
  | "geo-corroborated"
  | "dpe-confirmed"
  | "dpe-absent"
  | "conflict"
  | "low-margin"
  | "lot-in-building"
  | "dpe-fingerprint";

type ResolveStatus = "confirmed" | "probable" | "unresolved";

interface MatchFactor {
  criterion: string;
  similarity: number;
  expected?: string | number;
  actual?: string | number;
}

interface MatchBreakdownItem {
  criterion: string;
  matched: boolean;
  expected?: string | number;
  actual?: string | number;
  similarity?: number;
  selectivity?: number;
  contribution?: number;
  factors?: MatchFactor[];
  geoCoef?: number;
  distanceM?: number;
}

interface ResolvedAddress {
  address: string;
  lat: number;
  lon: number;
  parcelId?: string;
  ademeCertId?: string;
  confidence: number;
  status: ResolveStatus;
  /** @deprecated Dérivé de status === "confirmed" (rétro-compat UI). */
  resolved: boolean;
  distanceM?: number;
  flags?: ResolveFlag[];
  matchBreakdown: MatchBreakdownItem[];
  verifiedDpe?: { class: DpeLetter; kwhM2: number; gesKgCO2M2: number; surfaceM2?: number };
}

/** Bloc de diagnostic renvoyé au sidepanel (mode debug). */
interface ResolveDebug {
  /** Nombre de certificats ADEME retournés pour le code postal. */
  ademeTotal: number;
  /** Taille du vivier après gate spatial (= ademeTotal si pas de marqueur). */
  keptAfterSurfaceFilter: number;
  /** Un gate géo précis a-t-il été appliqué. */
  usedLandSurfacePass: boolean;
}

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

Deno.serve(async (req: Request) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as {
    deviceHash?: string;
    listingUrl?: string;
    input?: ResolverInput;
  } | null;
  if (!body?.deviceHash || !body.listingUrl || !body.input?.postalCode) {
    return json({ error: "missing_fields" }, 400);
  }

  // 1. Quota
  const usage = await callTrackUsage(req, {
    deviceHash: body.deviceHash,
    listingUrl: body.listingUrl,
    commit: false,
  });
  if (!usage.allowed) {
    return json({ candidates: [], usage });
  }

  // 2. Cache
  const supa = serviceClient();
  const cacheKey = buildCacheKey(body.input);
  const { data: cached } = await supa
    .from("address_cache")
    .select("payload, created_at")
    .eq("key", cacheKey)
    .maybeSingle();

  let candidates: ResolvedAddress[];
  let debug: (ResolveDebug & { fromCache: boolean }) | undefined;
  if (
    cached &&
    Date.now() - new Date(cached.created_at as string).getTime() < CACHE_TTL_MS
  ) {
    candidates = cached.payload as ResolvedAddress[];
    debug = { ademeTotal: -1, keptAfterSurfaceFilter: -1, usedLandSurfacePass: false, fromCache: true };
  } else {
    const r = await resolveAddress(body.input);
    candidates = r.candidates;
    debug = { ...r.debug, fromCache: false };
    await supa.from("address_cache").upsert({ key: cacheKey, payload: candidates });
  }

  // 3. Commit l'usage avec le résultat (best confidence)
  const top = candidates[0];
  await callTrackUsage(req, {
    deviceHash: body.deviceHash,
    listingUrl: body.listingUrl,
    resolvedAddress: top?.address,
    confidence: top?.confidence,
    commit: true,
  });

  return json({ candidates, usage, debug });
});

function buildCacheKey(input: ResolverInput): string {
  const bucket = (v: number | undefined, step: number) =>
    v == null ? "_" : String(Math.round(v / step) * step);
  const monthBucket = (d: string | undefined) => {
    if (!d) return "_";
    const m = d.match(/(\d{4})-(\d{2})/);
    return m ? `${m[1]}${m[2]}` : "_";
  };
  // Marqueur géo arrondi à ~10 m → entrées de cache distinctes par position.
  const geoBucket = input.geo
    ? `${input.geo.lat.toFixed(4)},${input.geo.lon.toFixed(4)}`
    : "_";
  return [
    // Version d'algo : bumper à chaque changement de logique pour invalider le cache.
    "v13-conf-calibration",
    input.postalCode,
    bucket(input.surface, 2),
    bucket(input.dpeKwhM2, 20),
    bucket(input.gesKgCO2M2, 5),
    bucket(input.yearBuilt, 5),
    bucket(input.landSurface, 20),
    monthBucket(input.dpeDate),
    geoBucket,
    input.propertyType ?? "_",
  ].join("|");
}

async function callTrackUsage(
  originalReq: Request,
  body: Record<string, unknown>,
): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const res = await fetch(`${baseUrl}/functions/v1/track-usage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: originalReq.headers.get("Authorization") ?? "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      "x-forwarded-for": originalReq.headers.get("x-forwarded-for") ?? "",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
//  RÉSOLUTION — réplique EXACTE de packages/core/src/resolver/{scorer,geo,index}
// ═══════════════════════════════════════════════════════════════════════════

interface AdemeCert {
  certId: string;
  address: string;
  lat?: number;
  lon?: number;
  surface: number;
  buildingType?: string;
  dpeClass?: DpeLetter;
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
  gesClass?: DpeLetter;
  yearBuilt?: number;
  dpeDate?: string;
  dpeVisitDate?: string;
  apartmentCount?: number;
  addressId?: string;
  geocodeStatus?: string;
  banScore?: number;
  landSurface?: number;
}

interface Parcel {
  id: string;
  contenance?: number;
}

// ── Scoring : croisements multiplicatifs × sélectivité (cf. scorer.ts) ──────

const TOL = {
  surfacePct: [5, 15],
  consoPct: [3, 12],
  gesPct: [15, 35],
  terrainPct: [10, 30],
  yearAbs: [3, 10],
  dateDays: [3, 45],
} as const;

const LETTER_FALLBACK = 0.4;
const SIM_MATCH = 0.999;
const SIM_PRESENT = 1e-9;
const SELECTIVITY_STRONG = 1.0;
const MS_PER_DAY = 86_400_000;

function simPct(value: number, target: number, tightPct: number, maxPct: number): number {
  const diff = Math.abs(value - target);
  const tight = (Math.abs(target) * tightPct) / 100;
  const max = (Math.abs(target) * maxPct) / 100;
  if (diff <= tight) return 1;
  if (diff >= max) return 0;
  return (max - diff) / (max - tight);
}

function simAbs(diff: number, tight: number, max: number): number {
  if (diff <= tight) return 1;
  if (diff >= max) return 0;
  return (max - diff) / (max - tight);
}

function parseDay(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function simDate(input: ResolverInput, cert: AdemeCert): number | null {
  const target = parseDay(input.dpeDate);
  if (target == null) return null;
  const cands = [parseDay(cert.dpeDate), parseDay(cert.dpeVisitDate)].filter(
    (v): v is number => v != null,
  );
  if (!cands.length) return null;
  const bestDays = Math.min(...cands.map((t) => Math.abs(target - t))) / MS_PER_DAY;
  return simAbs(bestDays, TOL.dateDays[0], TOL.dateDays[1]);
}

function simType(input: ResolverInput, cert: AdemeCert): number | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison" ? 1 : 0;
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble" ? 1 : 0;
}

interface Crit {
  key: string;
  sim(cert: AdemeCert): number | null;
  expected?: string | number;
  actual(cert: AdemeCert): string | number | undefined;
}

function criteria(input: ResolverInput): Record<string, Crit | undefined> {
  const c: Record<string, Crit | undefined> = {};

  if (input.surface != null) {
    const t = input.surface;
    c.surface = {
      key: "surface",
      expected: t,
      sim: (x) => simPct(x.surface, t, TOL.surfacePct[0], TOL.surfacePct[1]),
      actual: (x) => x.surface,
    };
  }

  if (input.dpeKwhM2 != null) {
    const t = input.dpeKwhM2;
    c.conso = {
      key: "dpeKwhM2",
      expected: t,
      sim: (x) => (x.dpeKwhM2 == null ? null : simPct(x.dpeKwhM2, t, TOL.consoPct[0], TOL.consoPct[1])),
      actual: (x) => x.dpeKwhM2,
    };
  } else if (input.dpeClass) {
    const t = input.dpeClass;
    c.conso = {
      key: "dpeClass",
      expected: t,
      sim: (x) => (x.dpeClass == null ? null : (x.dpeClass === t ? 1 : 0) * LETTER_FALLBACK),
      actual: (x) => x.dpeClass,
    };
  }

  if (input.gesKgCO2M2 != null) {
    const t = input.gesKgCO2M2;
    c.ges = {
      key: "gesKgCO2M2",
      expected: t,
      sim: (x) => (x.gesKgCO2M2 == null ? null : simPct(x.gesKgCO2M2, t, TOL.gesPct[0], TOL.gesPct[1])),
      actual: (x) => x.gesKgCO2M2,
    };
  } else if (input.gesClass) {
    const t = input.gesClass;
    c.ges = {
      key: "gesClass",
      expected: t,
      sim: (x) => (x.gesClass == null ? null : (x.gesClass === t ? 1 : 0) * LETTER_FALLBACK),
      actual: (x) => x.gesClass,
    };
  }

  if (input.yearBuilt != null) {
    const t = input.yearBuilt;
    c.year = {
      key: "yearBuilt",
      expected: t,
      sim: (x) => (x.yearBuilt == null ? null : simAbs(Math.abs(x.yearBuilt - t), TOL.yearAbs[0], TOL.yearAbs[1])),
      actual: (x) => x.yearBuilt,
    };
  }

  if (input.landSurface != null && input.propertyType === "Maison") {
    const t = input.landSurface;
    c.terrain = {
      key: "landSurface",
      expected: t,
      sim: (x) => (x.landSurface == null ? null : simPct(x.landSurface, t, TOL.terrainPct[0], TOL.terrainPct[1])),
      actual: (x) => x.landSurface,
    };
  }

  if (input.apartmentCount != null) {
    const t = input.apartmentCount;
    c.apts = {
      key: "apartmentCount",
      expected: t,
      sim: (x) => (x.apartmentCount == null ? null : x.apartmentCount === t ? 1 : 0),
      actual: (x) => x.apartmentCount,
    };
  }

  if (input.dpeDate) {
    c.date = {
      key: "dpeDate",
      expected: input.dpeDate,
      sim: (x) => simDate(input, x),
      actual: (x) => x.dpeDate ?? x.dpeVisitDate,
    };
  }

  if (input.propertyType) {
    c.type = {
      key: "buildingType",
      expected: input.propertyType,
      sim: (x) => simType(input, x),
      actual: (x) => x.buildingType,
    };
  }

  return c;
}

interface ComboDef {
  label: string;
  members: Crit[];
}

function comboDefs(input: ResolverInput): ComboDef[] {
  const c = criteria(input);

  const spineMembers: Crit[] = [];
  if (c.date) spineMembers.push(c.date);
  if (c.conso) spineMembers.push(c.conso);
  if (c.type) spineMembers.push(c.type);
  const spineIsFallback = spineMembers.length === 0;
  if (spineIsFallback) {
    if (c.surface) spineMembers.push(c.surface);
    if (c.type) spineMembers.push(c.type);
  }

  const combos: ComboDef[] = [];
  if (spineMembers.length) combos.push({ label: "épine", members: spineMembers });

  const spine = spineMembers;
  if (c.ges) combos.push({ label: "épine×ges", members: [...spine, c.ges] });
  if (c.surface && !spineIsFallback) combos.push({ label: "épine×surface", members: [...spine, c.surface] });
  if (c.year) combos.push({ label: "épine×année", members: [...spine, c.year] });
  if (c.apts) combos.push({ label: "épine×lots", members: [...spine, c.apts] });
  if (c.terrain) combos.push({ label: "terrain", members: [c.terrain] });

  return combos;
}

function comboValue(combo: ComboDef, cert: AdemeCert): number {
  let v = 1;
  for (const m of combo.members) {
    const s = m.sim(cert);
    if (s == null || s <= 0) return 0;
    v *= s;
  }
  return v;
}

function comboMatches(combo: ComboDef, cert: AdemeCert): boolean {
  for (const m of combo.members) {
    const s = m.sim(cert);
    if (s == null || s < SIM_PRESENT) return false;
  }
  return true;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function computeSelectivities(input: ResolverInput, pool: AdemeCert[]): Map<string, number> {
  const sels = new Map<string, number>();
  const n = pool.length;
  for (const combo of comboDefs(input)) {
    let match = 0;
    for (const c of pool) if (comboMatches(combo, c)) match += 1;
    sels.set(combo.label, -Math.log((1 + match) / (1 + n)));
  }
  return sels;
}

interface Scored {
  cert: AdemeCert;
  score: number;
  breakdown: MatchBreakdownItem[];
  strongConcordant: number;
}

function scoreCertificate(
  input: ResolverInput,
  cert: AdemeCert,
  selectivities: Map<string, number>,
): Scored {
  const breakdown: MatchBreakdownItem[] = [];
  let score = 0;
  let strongConcordant = 0;

  for (const combo of comboDefs(input)) {
    const value = comboValue(combo, cert);
    const selectivity = selectivities.get(combo.label) ?? 0;
    const contribution = value * selectivity;
    score += contribution;
    if (value > 0 && selectivity >= SELECTIVITY_STRONG) strongConcordant += 1;

    const factors: MatchFactor[] = combo.members.map((m) => ({
      criterion: m.key,
      similarity: round3(m.sim(cert) ?? 0),
      expected: m.expected,
      actual: m.actual(cert),
    }));
    const distinctive = combo.members[combo.members.length - 1];
    breakdown.push({
      criterion: combo.label,
      matched: value >= SIM_MATCH,
      similarity: round3(value),
      selectivity: round3(selectivity),
      contribution: round3(contribution),
      factors,
      expected: distinctive?.expected,
      actual: distinctive?.actual(cert),
    });
  }

  return { cert, score: round3(score), breakdown, strongConcordant };
}

// ── Géo (cf. geo.ts) ───────────────────────────────────────────────────────

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111_200;
  const dLon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180) * 111_320;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function isPreciseMarker(geo: GeoHint): boolean {
  if (geo.precise != null) return geo.precise;
  if (geo.precision === "gps") return true;
  if (geo.precision === "disk") return false;
  return geo.radiusM == null || geo.radiusM <= 50;
}

function geoDiskCoef(distanceM: number | undefined, radiusM: number): number {
  if (distanceM == null) return 1;
  if (distanceM <= radiusM) return 1;
  const coef = 1 - (distanceM - radiusM) / radiusM;
  return coef < 0 ? 0 : coef;
}

// ── Orchestration (cf. index.ts) ───────────────────────────────────────────

const PRECISE_GATE_M = 30;
const MARKER_DEMOTE_M = 200;
const GEO_DECIDE_M = 25;
const GEO_ISOLATED_M = 100;
const DISK_DEFAULT_R = 300;
const LOT_BUILDING_RADIUS = 80;
const CONSO_EXACT = 0.5;
const CONSO_GAP = 0.5;
const FP_SURFACE_TOL = 3;
const MARGIN_CONFIRM = 1.5;
const MARGIN_PROBABLE = 1.2;
const ACC_K = 3;
const ACC_CAP = 10;
const W_ACC = 0.45;
const W_MARGIN = 0.55;

async function resolveAddress(
  input: ResolverInput,
): Promise<{ candidates: ResolvedAddress[]; debug: ResolveDebug }> {
  const certs = await fetchAdeme(input);
  if (!certs.length) {
    return { candidates: [], debug: { ademeTotal: 0, keptAfterSurfaceFilter: 0, usedLandSurfacePass: false } };
  }

  const dist = new Map<AdemeCert, number>();
  let precise = false;
  let pool = certs;
  let diskRadius = 0;
  if (input.geo) {
    const g = input.geo;
    for (const c of certs) {
      if (c.lat != null && c.lon != null) dist.set(c, distanceM(g.lat, g.lon, c.lat, c.lon));
    }
    const nearest = Math.min(...[...dist.values()], Infinity);
    precise = isPreciseMarker(g) && nearest <= MARKER_DEMOTE_M;
    diskRadius = g.radiusM ?? DISK_DEFAULT_R;
    const gateR = precise ? PRECISE_GATE_M : diskRadius;
    const gated = certs.filter((c) => (dist.get(c) ?? Infinity) <= gateR);
    if (gated.length) pool = gated;
  }

  const selectivities = computeSelectivities(input, pool);
  const useDiskCoef = input.geo != null && !precise;
  const scored = pool.map((c) => {
    const s = scoreCertificate(input, c, selectivities);
    if (useDiskCoef) s.score = round3(s.score * geoDiskCoef(dist.get(c), diskRadius));
    return s;
  });
  const addresses = groupByAddress(scored);
  let ranked = decide(input, addresses, dist, precise, 5);

  // Repli « empreinte DPE » (cf. index.ts §5bis) — conso exacte unique.
  if (ranked[0]?.status === "unresolved") {
    const fp = dpeFingerprintCandidate(input, certs, dist);
    if (fp) ranked = promoteCandidates([fp], ranked, 5);
  }

  // Repli « lot dans immeuble » (cf. index.ts §5ter) — marqueur PRÉCIS requis.
  if (precise && ranked[0]?.status === "unresolved") {
    const lots = lotInBuildingCandidates(input, certs, dist, 5);
    if (lots.length) ranked = promoteCandidates(lots, ranked, 5);
  }

  // Cadastre top-1
  if (ranked[0] && ranked[0].lat && ranked[0].lon) {
    const parcel = await lookupParcel(ranked[0].lat, ranked[0].lon);
    if (parcel) ranked[0].parcelId = parcel.id;
  }

  return {
    candidates: ranked,
    debug: {
      ademeTotal: certs.length,
      keptAfterSurfaceFilter: pool.length,
      usedLandSurfacePass: input.geo != null && precise,
    },
  };
}

function addressKey(c: AdemeCert): string {
  if (c.addressId) return `ban:${c.addressId}`;
  return `addr:${c.address.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function newer(a: AdemeCert, b: AdemeCert): boolean {
  const ta = Date.parse(a.dpeDate ?? "");
  const tb = Date.parse(b.dpeDate ?? "");
  if (!Number.isFinite(ta)) return false;
  if (!Number.isFinite(tb)) return true;
  return ta > tb;
}

function groupByAddress(scored: Scored[]): Scored[] {
  const best = new Map<string, Scored>();
  for (const s of scored) {
    const key = addressKey(s.cert);
    const cur = best.get(key);
    if (!cur || s.score > cur.score || (s.score === cur.score && newer(s.cert, cur.cert))) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

type Coherence = "concordant" | "absent" | "conflict";

const COH_CONSO_TOL = 0.25;
const COH_GES_TOL = 0.35;
const SURFACE_CONFLICT_RATIO = 1.4;
const GES_CONFLICT_STEPS = 2;

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

function typeCompatible(input: ResolverInput, cert: AdemeCert): boolean | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison";
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble";
}

/**
 * Cohérence DPE basée sur la SIGNATURE ÉNERGÉTIQUE (DPE/GES) + type, PAS la
 * surface (deux logements voisins partagent souvent une surface proche).
 *   – absent  : rien de comparable ; conflict : type incompatible OU DPE/GES
 *     discordants ; concordant : ≥ 1 indicateur énergie concorde.
 */
function coherence(input: ResolverInput, cert: AdemeCert): Coherence {
  if (typeCompatible(input, cert) === false) return "conflict";
  // Échelle de bien radicalement différente (immeuble entier vs lot) → conflit.
  if (input.surface != null && cert.surface > 0) {
    const ratio = Math.max(input.surface, cert.surface) / Math.min(input.surface, cert.surface);
    if (ratio > SURFACE_CONFLICT_RATIO) return "conflict";
  }
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
function toVerifiedDpe(c: AdemeCert): ResolvedAddress["verifiedDpe"] {
  if (!c.dpeClass || c.dpeKwhM2 == null || c.gesKgCO2M2 == null) return undefined;
  return {
    class: c.dpeClass,
    kwhM2: c.dpeKwhM2,
    gesKgCO2M2: c.gesKgCO2M2,
    surfaceM2: c.surface > 0 ? c.surface : undefined,
  };
}

// ── Repli « empreinte DPE » (conso exacte unique, cf. index.ts) ────────────

function dpeFingerprintCandidate(
  input: ResolverInput,
  certs: AdemeCert[],
  dist: Map<AdemeCert, number>,
): ResolvedAddress | null {
  if (input.dpeKwhM2 == null || input.surface == null) return null;
  const target = input.dpeKwhM2;
  const radius = input.geo ? (input.geo.radiusM ?? DISK_DEFAULT_R) : Infinity;

  const bestByAddr = new Map<string, { cert: AdemeCert; dConso: number }>();
  for (const c of certs) {
    if (c.dpeKwhM2 == null) continue;
    if (input.geo) {
      const d = dist.get(c);
      if (d == null || d > radius) continue;
    }
    if (typeCompatible(input, c) === false) continue;
    if (input.dpeClass && c.dpeClass && c.dpeClass !== input.dpeClass) continue;
    // La conso seule ne fait pas une empreinte : surface ET GES doivent corroborer.
    if (Math.abs(c.surface - input.surface) > FP_SURFACE_TOL) continue;
    if (input.gesClass && c.gesClass && c.gesClass !== input.gesClass) continue;
    const dConso = Math.abs(c.dpeKwhM2 - target);
    const key = addressKey(c);
    const cur = bestByAddr.get(key);
    if (!cur || dConso < cur.dConso) bestByAddr.set(key, { cert: c, dConso });
  }

  const ranked = [...bestByAddr.values()].sort((a, b) => a.dConso - b.dConso);
  const best = ranked[0];
  if (!best || best.dConso > CONSO_EXACT) return null;
  if (ranked[1] && ranked[1].dConso - best.dConso < CONSO_GAP) return null;

  const c = best.cert;
  const d = dist.get(c);
  // Empreinte (conso exacte + surface ±3 + unicité) = 76 ; corroborations
  // optionnelles (GES, marqueur géo) renforcent, plafonné à 85 (cf. index.ts).
  let fpConf = 76;
  if (input.gesClass && c.gesClass && c.gesClass === input.gesClass) fpConf += 4;
  if (input.geo && d != null) fpConf += 3;
  fpConf = Math.min(fpConf, 85);
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
        criterion: "empreinte-conso",
        matched: true,
        similarity: 1,
        expected: target,
        actual: c.dpeKwhM2,
        factors: [
          { criterion: "dpeKwhM2", similarity: 1, expected: target, actual: c.dpeKwhM2 },
          { criterion: "surface", similarity: 1, expected: input.surface, actual: c.surface },
        ],
      },
    ],
    verifiedDpe: toVerifiedDpe(c),
  };
}

// ── Repli « lot dans immeuble » (cf. index.ts) ─────────────────────────────

function dpeMatch(input: ResolverInput, cert: AdemeCert): { ok: boolean; exact: boolean } {
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null) {
    return { ok: within(cert.dpeKwhM2, input.dpeKwhM2, COH_CONSO_TOL), exact: true };
  }
  if (input.dpeClass && cert.dpeClass) {
    return { ok: cert.dpeClass === input.dpeClass, exact: false };
  }
  return { ok: false, exact: false };
}

interface LotCand {
  cert: AdemeCert;
  d: number;
  exact: boolean;
  aptMatch: boolean;
  lotFit: number;
}

function rankLot(c: LotCand): number {
  return (c.aptMatch ? 2 : 0) + (c.exact ? 1 : 0);
}

function lotFitsBuilding(input: ResolverInput, cert: AdemeCert): boolean {
  if (input.surface == null) return true;
  if (input.surface > cert.surface) return false;
  if (cert.apartmentCount != null && cert.apartmentCount >= 3 && input.surface > cert.surface / 2) {
    return false;
  }
  return true;
}

function lotInBuildingCandidates(
  input: ResolverInput,
  certs: AdemeCert[],
  dist: Map<AdemeCert, number>,
  limit: number,
): ResolvedAddress[] {
  if (!input.geo) return [];
  if (input.propertyType !== "Appartement" && input.propertyType !== "Immeuble") return [];

  const cands: LotCand[] = [];
  for (const c of certs) {
    if (c.buildingType !== "immeuble") continue;
    const d = dist.get(c);
    if (d == null || d > LOT_BUILDING_RADIUS) continue;
    const m = dpeMatch(input, c);
    if (!m.ok) continue;
    if (!lotFitsBuilding(input, c)) continue;
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
  const best = new Map<string, LotCand>();
  for (const cand of cands) {
    const key = addressKey(cand.cert);
    const cur = best.get(key);
    if (!cur || cmpLot(cand, cur) < 0) best.set(key, cand);
  }
  const ordered = [...best.values()].sort(cmpLot);

  // Un SEUL immeuble concordant dans le rayon parcelle = signal décisif (cf. index.ts).
  const unique = best.size === 1;

  return ordered.slice(0, limit).map((cand) => {
    const c = cand.cert;
    const gesMatch = !!input.gesClass && !!c.gesClass && c.gesClass === input.gesClass;
    const bonus = (cand.exact ? 8 : 0) + (gesMatch ? 4 : 0) + (cand.aptMatch ? 6 : 0);
    const conf = unique
      ? Math.min(88, 76 + bonus)
      : Math.max(45, Math.min(74, 55 + bonus - Math.round(cand.d / 10)));
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

function decide(
  input: ResolverInput,
  addresses: Scored[],
  dist: Map<AdemeCert, number>,
  precise: boolean,
  limit: number,
): ResolvedAddress[] {
  if (!addresses.length) return [];

  const byScore = [...addresses].sort((a, b) => b.score - a.score);
  const score1 = byScore[0]!.score;
  const score2 = byScore[1]?.score ?? 0;
  const margin = score1 / Math.max(score2, 1e-6);
  const marginScore = clamp01(1 - 1 / margin);
  const acc = Math.min(score1 * ACC_K, ACC_CAP) / ACC_CAP;
  const confAttr = clamp01(W_ACC * acc + W_MARGIN * marginScore);
  const strong = byScore[0]!.strongConcordant;

  let top = byScore[0]!;
  let decision: Decision;

  if (input.geo != null && precise) {
    const byDist = [...addresses].sort(
      (a, b) => (dist.get(a.cert) ?? Infinity) - (dist.get(b.cert) ?? Infinity),
    );
    top = byDist[0]!;
    const d0 = dist.get(top.cert) ?? Infinity;
    const d1 = byDist[1] ? (dist.get(byDist[1].cert) ?? Infinity) : Infinity;
    const decided = d0 <= GEO_DECIDE_M && d1 > GEO_ISOLATED_M;
    const confGeo = clamp01(d0 < 15 ? 1 : d0 <= GEO_DECIDE_M ? 0.85 : 0.6) * (decided ? 1 : 0.7);
    decision = decidePreciseGeo(input, top, d0, confGeo, confAttr);
  } else {
    decision = decideAttributes(margin, strong, confAttr, coherence(input, top.cert));
  }

  // Un candidat alternatif ne peut pas afficher plus de confiance que le top :
  // confiance proportionnelle au score relatif, plafonnée à celle du top.
  const rest = byScore.filter((s) => s !== top);
  const ordered = [top, ...rest].slice(0, limit);
  return ordered.map((s, i) => {
    if (i === 0) return toResolved(s, dist, input, decision);
    const conf =
      top.score > 0 ? Math.min(Math.round((s.score / top.score) * decision.confidence), decision.confidence) : 0;
    return toResolved(s, dist, input, { status: "unresolved", confidence: conf, flags: [] });
  });
}

function decidePreciseGeo(input: ResolverInput, top: Scored, d0: number, confGeo: number, confAttr: number): Decision {
  const coh = coherence(input, top.cert);
  if (coh === "conflict") {
    return { status: "unresolved", confidence: Math.min(Math.round(confAttr * 100), 30), flags: ["conflict"] };
  }
  if (coh === "absent") {
    return {
      status: "probable",
      confidence: Math.round(confGeo * 80),
      flags: ["geo-decided", "dpe-absent"],
    };
  }
  // HAUTE seulement si le cert cohérent est dans le gate serré ; sinon le
  // marqueur précis pointe entre les adresses connues → probable.
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
    // « Confirmed » = affiché comme vérifié : jamais sous 85 (cf. index.ts).
    return { status: "confirmed", confidence: Math.max(85, confidence), flags: [] };
  }
  if (margin >= MARGIN_PROBABLE) {
    // Bande « probable » [70, 84] : marge et absence de conflit déjà gatées (cf. index.ts).
    return { status: "probable", confidence: 70 + Math.round(confAttr * 14), flags: [] };
  }
  return { status: "unresolved", confidence, flags: ["low-margin"] };
}

function toResolved(
  s: Scored,
  dist: Map<AdemeCert, number>,
  input: ResolverInput,
  decision?: Decision,
): ResolvedAddress {
  const c = s.cert;
  const d = dist.get(c);
  const status: ResolveStatus = decision?.status ?? "unresolved";
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

// ── ADEME (cf. ademe.ts) ───────────────────────────────────────────────────

const ADEME_DATASET_IDS = ["meg-83tjwtg8dyz4vv7h1dqe", "dpe03existant"] as const;

function asLetter(v: unknown): DpeLetter | undefined {
  if (typeof v !== "string") return undefined;
  const up = v.trim().toUpperCase();
  if (["A", "B", "C", "D", "E", "F", "G"].includes(up)) return up as DpeLetter;
  return undefined;
}

async function fetchAdeme(input: ResolverInput): Promise<AdemeCert[]> {
  let res: Response | null = null;
  let lastStatus = 0;
  let lastUrl = "";
  for (const datasetId of ADEME_DATASET_IDS) {
    const url = new URL(`https://data.ademe.fr/data-fair/api/v1/datasets/${datasetId}/lines`);
    // Max d'une page ADEME : une commune dense dépasse 1000 certs ; tronquer
    // écarterait le bon certificat du gate géo (cf. core/ademe.ts).
    url.searchParams.set("size", "10000");
    url.searchParams.set("code_postal_ban_eq", input.postalCode);
    // Pas de filtre type_batiment : un appartement en copropriété peut n'avoir
    // qu'un DPE de type `immeuble` (ou un lot), exclu sinon avant le scoring.
    url.searchParams.set(
      "select",
      "numero_dpe,adresse_ban,code_postal_ban,nom_commune_ban,_geopoint,surface_habitable_logement,surface_habitable_immeuble,nombre_appartement,type_batiment,etiquette_dpe,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,etiquette_ges,annee_construction,date_etablissement_dpe,date_visite_diagnostiqueur,identifiant_ban,statut_geocodage,score_ban",
    );
    lastUrl = url.toString();
    const r = await fetch(lastUrl, {
      headers: {
        "user-agent": "empir-copilot/0.1 (+https://empir-copilot.fr)",
        accept: "application/json",
      },
    });
    if (r.ok) {
      res = r;
      break;
    }
    lastStatus = r.status;
  }
  if (!res) throw new Error(`ADEME ${lastStatus} for ${lastUrl}`);
  const json = (await res.json()) as { results?: Record<string, unknown>[] };
  const out: AdemeCert[] = [];
  for (const r of json.results ?? []) {
    const certId = (r.numero_dpe as string | undefined) ?? "";
    const surface =
      (r.surface_habitable_logement as number | undefined) ??
      (r.surface_habitable_immeuble as number | undefined);
    if (!certId || surface == null) continue;
    const geo = typeof r._geopoint === "string" ? r._geopoint.split(",", 2).map(Number) : [];
    const [lat, lon] = geo;
    out.push({
      certId,
      address: (r.adresse_ban as string) ?? "",
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      surface,
      buildingType: (r.type_batiment as string | undefined)?.toLowerCase(),
      dpeClass: asLetter(r.etiquette_dpe),
      dpeKwhM2: r.conso_5_usages_par_m2_ep as number | undefined,
      gesKgCO2M2: r.emission_ges_5_usages_par_m2 as number | undefined,
      gesClass: asLetter(r.etiquette_ges),
      yearBuilt: (r.annee_construction as number | undefined) || undefined,
      dpeDate: (r.date_etablissement_dpe as string | undefined) || undefined,
      dpeVisitDate: (r.date_visite_diagnostiqueur as string | undefined) || undefined,
      apartmentCount: (r.nombre_appartement as number | undefined) || undefined,
      addressId: (r.identifiant_ban as string | undefined) || undefined,
      geocodeStatus: (r.statut_geocodage as string | undefined) || undefined,
      banScore: r.score_ban as number | undefined,
    });
  }
  return out;
}

async function lookupParcel(lat: number, lon: number): Promise<Parcel | null> {
  try {
    const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
    const res = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: { properties: { id?: string; contenance?: number } }[];
    };
    const props = json.features?.[0]?.properties;
    if (!props?.id) return null;
    return { id: props.id, contenance: props.contenance };
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
