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
  | "dpe-confirmed"
  | "dpe-absent"
  | "conflict"
  | "low-margin";

interface MatchBreakdownItem {
  criterion: string;
  matched: boolean;
  expected?: string | number;
  actual?: string | number;
  similarity?: number;
  weight?: number;
  selectivity?: number;
  contribution?: number;
  distanceM?: number;
}

interface ResolvedAddress {
  address: string;
  lat: number;
  lon: number;
  parcelId?: string;
  ademeCertId?: string;
  confidence: number;
  resolved: boolean;
  distanceM?: number;
  flags?: ResolveFlag[];
  matchBreakdown: MatchBreakdownItem[];
  verifiedDpe?: { class: DpeLetter; kwhM2: number; gesKgCO2M2: number };
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
    "v3-adaptive",
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

// ── Scoring adaptatif (cf. scorer.ts) ──────────────────────────────────────

const W = {
  dpeKwhM2: 0.9,
  surface: 0.85,
  dpeDate: 0.85,
  gesKgCO2M2: 0.6,
  yearBuilt: 0.5,
  landSurface: 0.5,
  apartmentCount: 0.5,
  dpeClass: 0.35,
  gesClass: 0.3,
  buildingType: 0.25,
} as const;

const SIM_MATCH = 0.999;
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
  return simAbs(bestDays, 3, 10);
}

function buildingTypeSim(input: ResolverInput, cert: AdemeCert): number | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison" ? 1 : 0;
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble" ? 1 : 0;
}

interface CritDef {
  key: string;
  weight: number;
  expected: string | number;
  sim(cert: AdemeCert): number | null;
  actual(cert: AdemeCert): string | number | undefined;
}

function activeCriteria(input: ResolverInput): CritDef[] {
  const crits: CritDef[] = [];

  if (input.surface != null) {
    const target = input.surface;
    crits.push({
      key: "surface",
      weight: W.surface,
      expected: target,
      sim: (c) => simPct(c.surface, target, 5, 15),
      actual: (c) => c.surface,
    });
  }

  if (input.dpeKwhM2 != null) {
    const target = input.dpeKwhM2;
    crits.push({
      key: "dpeKwhM2",
      weight: W.dpeKwhM2,
      expected: target,
      sim: (c) => (c.dpeKwhM2 == null ? null : simPct(c.dpeKwhM2, target, 5, 15)),
      actual: (c) => c.dpeKwhM2,
    });
  } else if (input.dpeClass) {
    const target = input.dpeClass;
    crits.push({
      key: "dpeClass",
      weight: W.dpeClass,
      expected: target,
      sim: (c) => (c.dpeClass == null ? null : c.dpeClass === target ? 1 : 0),
      actual: (c) => c.dpeClass,
    });
  }

  if (input.gesKgCO2M2 != null) {
    const target = input.gesKgCO2M2;
    crits.push({
      key: "gesKgCO2M2",
      weight: W.gesKgCO2M2,
      expected: target,
      sim: (c) => (c.gesKgCO2M2 == null ? null : simPct(c.gesKgCO2M2, target, 15, 30)),
      actual: (c) => c.gesKgCO2M2,
    });
  } else if (input.gesClass) {
    const target = input.gesClass;
    crits.push({
      key: "gesClass",
      weight: W.gesClass,
      expected: target,
      sim: (c) => (c.gesClass == null ? null : c.gesClass === target ? 1 : 0),
      actual: (c) => c.gesClass,
    });
  }

  if (input.yearBuilt != null) {
    const target = input.yearBuilt;
    crits.push({
      key: "yearBuilt",
      weight: W.yearBuilt,
      expected: target,
      sim: (c) => (c.yearBuilt == null ? null : simAbs(Math.abs(c.yearBuilt - target), 2, 5)),
      actual: (c) => c.yearBuilt,
    });
  }

  if (input.landSurface != null && input.propertyType === "Maison") {
    const target = input.landSurface;
    crits.push({
      key: "landSurface",
      weight: W.landSurface,
      expected: target,
      sim: (c) => (c.landSurface == null ? null : simPct(c.landSurface, target, 10, 25)),
      actual: (c) => c.landSurface,
    });
  }

  if (input.apartmentCount != null) {
    const target = input.apartmentCount;
    crits.push({
      key: "apartmentCount",
      weight: W.apartmentCount,
      expected: target,
      sim: (c) => (c.apartmentCount == null ? null : c.apartmentCount === target ? 1 : 0),
      actual: (c) => c.apartmentCount,
    });
  }

  if (input.dpeDate) {
    crits.push({
      key: "dpeDate",
      weight: W.dpeDate,
      expected: input.dpeDate,
      sim: (c) => simDate(input, c),
      actual: (c) => c.dpeDate ?? c.dpeVisitDate,
    });
  }

  if (input.propertyType) {
    crits.push({
      key: "buildingType",
      weight: W.buildingType,
      expected: input.propertyType,
      sim: (c) => buildingTypeSim(input, c),
      actual: (c) => c.buildingType,
    });
  }

  return crits;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function computeSelectivities(input: ResolverInput, pool: AdemeCert[]): Map<string, number> {
  const sels = new Map<string, number>();
  const n = pool.length;
  for (const crit of activeCriteria(input)) {
    let match = 0;
    for (const c of pool) {
      const s = crit.sim(c);
      if (s != null && s >= SIM_MATCH) match += 1;
    }
    sels.set(crit.key, -Math.log((1 + match) / (1 + n)));
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

  for (const crit of activeCriteria(input)) {
    const sim = crit.sim(cert);
    if (sim == null) continue;
    const selectivity = selectivities.get(crit.key) ?? 0;
    const contribution = crit.weight * sim * selectivity;
    score += contribution;
    if (sim >= 0.5 && selectivity >= SELECTIVITY_STRONG) strongConcordant += 1;
    breakdown.push({
      criterion: crit.key,
      matched: sim >= SIM_MATCH,
      similarity: round3(sim),
      weight: crit.weight,
      selectivity: round3(selectivity),
      contribution: round3(contribution),
      expected: crit.expected,
      actual: crit.actual(cert),
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
  if (geo.precision === "gps") return true;
  if (geo.precision === "disk") return false;
  return geo.radiusM == null || geo.radiusM <= 50;
}

// ── Orchestration (cf. index.ts) ───────────────────────────────────────────

const PRECISE_GATE_M = 30;
const MARKER_DEMOTE_M = 200;
const GEO_DECIDE_M = 25;
const GEO_ISOLATED_M = 100;
const MARGIN_RESOLVE = 1.5;

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
  if (input.geo) {
    const g = input.geo;
    for (const c of certs) {
      if (c.lat != null && c.lon != null) dist.set(c, distanceM(g.lat, g.lon, c.lat, c.lon));
    }
    const nearest = Math.min(...[...dist.values()], Infinity);
    precise = isPreciseMarker(g) && nearest <= MARKER_DEMOTE_M;
    const gateR = precise ? PRECISE_GATE_M : (g.radiusM ?? 300);
    const gated = certs.filter((c) => (dist.get(c) ?? Infinity) <= gateR);
    if (gated.length) pool = gated;
  }

  const selectivities = computeSelectivities(input, pool);
  const scored = pool.map((c) => scoreCertificate(input, c, selectivities));
  const addresses = groupByAddress(scored);
  const ranked = decide(input, addresses, dist, precise, 5);

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

const COHERENCE_KEYS = new Set(["surface", "dpeKwhM2", "dpeClass", "gesKgCO2M2", "gesClass"]);

type Coherence = "concordant" | "absent" | "conflict";

function coherence(sc: Scored): Coherence {
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
  const confAttr = clamp01(0.6 * marginScore + 0.4 * clamp01(byScore[0]!.strongConcordant / 2));

  let top = byScore[0]!;
  const flags: ResolveFlag[] = [];
  let confidence: number;
  let resolved: boolean;

  const usePreciseGeo = input.geo != null && precise;
  if (usePreciseGeo) {
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
      confidence = Math.round(confGeo * 85);
      resolved = confGeo >= 0.7;
    } else {
      flags.push("geo-decided", "dpe-confirmed");
      confidence = Math.max(85, Math.round(confGeo * 100));
      resolved = true;
    }
  } else {
    if (margin < MARGIN_RESOLVE) flags.push("low-margin");
    confidence = Math.round(confAttr * 100);
    resolved = margin >= MARGIN_RESOLVE && byScore[0]!.strongConcordant >= 1;
  }

  const rest = byScore.filter((s) => s !== top);
  const ordered = [top, ...rest].slice(0, limit);

  return ordered.map((s, i) =>
    toResolved(s, dist, i === 0 ? { confidence, resolved, flags } : undefined),
  );
}

function toResolved(
  s: Scored,
  dist: Map<AdemeCert, number>,
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
    matchBreakdown: s.breakdown,
    verifiedDpe:
      c.dpeClass && c.dpeKwhM2 != null && c.gesKgCO2M2 != null
        ? { class: c.dpeClass, kwhM2: c.dpeKwhM2, gesKgCO2M2: c.gesKgCO2M2 }
        : undefined,
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
    url.searchParams.set("size", "1000");
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
