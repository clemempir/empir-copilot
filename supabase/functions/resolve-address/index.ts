/**
 * resolve-address — résolution d'adresse à la manière de parcellai.re.
 *
 * POST { deviceHash, listingUrl, input: ResolverInput }
 *
 * Pipeline :
 *   1. Délègue à track-usage pour appliquer le quota
 *   2. Cache (table address_cache) keyé sur (postal, surface bucket, dpe bucket)
 *   3. Requête ADEME + scoring + lookup cadastre (logique copiée de
 *      packages/core/src/resolver — gardée synchronisée à la main, l'import
 *      d'un workspace package depuis une Edge Function n'est pas trivial)
 *
 * Renvoie : { candidates: ResolvedAddress[], usage: {used, limit, allowed} }
 */
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface ResolverInput {
  postalCode: string;
  city?: string;
  surface?: number;
  rooms?: number;
  yearBuilt?: number;
  dpeClass?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
  gesClass?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  landSurface?: number;
  dpeDate?: string;
  propertyType?: "Appartement" | "Maison";
}

interface ResolvedAddress {
  address: string;
  lat: number;
  lon: number;
  parcelId?: string;
  ademeCertId?: string;
  confidence: number;
  matchBreakdown: { criterion: string; weight: number; matched: boolean }[];
  verifiedDpe?: { class: string; kwhM2: number; gesKgCO2M2: number };
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
  if (
    cached &&
    Date.now() - new Date(cached.created_at as string).getTime() < CACHE_TTL_MS
  ) {
    candidates = cached.payload as ResolvedAddress[];
  } else {
    candidates = await resolveAddress(body.input);
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

  return json({ candidates, usage });
});

function buildCacheKey(input: ResolverInput): string {
  const bucket = (v: number | undefined, step: number) =>
    v == null ? "_" : String(Math.round(v / step) * step);
  // Date DPE bucketisée au mois (yyyymm) pour éviter les collisions sans casser
  // la mutualisation des biens proches.
  const monthBucket = (d: string | undefined) => {
    if (!d) return "_";
    const m = d.match(/(\d{4})-(\d{2})/);
    return m ? `${m[1]}${m[2]}` : "_";
  };
  return [
    input.postalCode,
    bucket(input.surface, 2),
    bucket(input.dpeKwhM2, 20),
    bucket(input.gesKgCO2M2, 5),
    bucket(input.yearBuilt, 5),
    bucket(input.landSurface, 20),
    monthBucket(input.dpeDate),
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

// ─── Résolution d'adresse (réplique de packages/core/src/resolver) ─────────
//
// Si tu modifies l'algo, propage le changement dans packages/core/src/resolver
// pour garder la même logique disponible en tests Vitest.

const WEIGHTS = {
  surface: 28,
  dpeKwhM2: 22,
  dpeClass: 8,
  gesKgCO2M2: 12,
  gesClass: 7,
  yearBuilt: 11,
  landSurface: 7,
  dpeDate: 5,
  buildingType: 5,
} as const;

interface AdemeCert {
  certId: string;
  address: string;
  lat?: number;
  lon?: number;
  surface: number;
  buildingType?: string;
  dpeClass?: ResolverInput["dpeClass"];
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
  gesClass?: ResolverInput["dpeClass"];
  yearBuilt?: number;
  dpeDate?: string;
  /** Renseigné a posteriori depuis la contenance cadastrale (passe 2 maisons). */
  landSurface?: number;
}

interface Parcel {
  id: string;
  contenance?: number;
}

async function resolveAddress(input: ResolverInput): Promise<ResolvedAddress[]> {
  const certs = await fetchAdeme(input);

  // Passe 1 — vivier un peu plus large que la limite finale.
  let ranked = rank(input, certs).slice(0, 5);

  const parcelByCertId = new Map<string, Parcel>();

  // Passe 2 — surface du terrain (maisons seulement, et seulement si l'annonce
  // la fournit : garde-fou coût sur les appels cadastre).
  const useLandSurface =
    input.landSurface != null && input.propertyType === "Maison";

  if (useLandSurface) {
    await Promise.all(
      ranked.map(async ({ cert }) => {
        if (cert.lat == null || cert.lon == null) return;
        const parcel = await lookupParcel(cert.lat, cert.lon);
        if (parcel) {
          parcelByCertId.set(cert.certId, parcel);
          if (parcel.contenance != null) cert.landSurface = parcel.contenance;
        }
      }),
    );
    ranked = rank(input, ranked.map((r) => r.cert)).slice(0, 5);
  }

  const out: ResolvedAddress[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const { cert, confidence, breakdown } = ranked[i]!;
    let parcelId: string | undefined = parcelByCertId.get(cert.certId)?.id;
    if (i === 0 && parcelId == null && cert.lat != null && cert.lon != null) {
      parcelId = (await lookupParcel(cert.lat, cert.lon))?.id ?? undefined;
    }
    out.push({
      address: cert.address,
      lat: cert.lat ?? 0,
      lon: cert.lon ?? 0,
      parcelId,
      ademeCertId: cert.certId,
      confidence,
      matchBreakdown: breakdown,
      verifiedDpe:
        cert.dpeClass && cert.dpeKwhM2 != null && cert.gesKgCO2M2 != null
          ? { class: cert.dpeClass, kwhM2: cert.dpeKwhM2, gesKgCO2M2: cert.gesKgCO2M2 }
          : undefined,
    });
  }
  return out;
}

// ADEME data-fair expose le dataset sous deux ids : un alias court
// (`dpe03existant`) et l'id réel généré (`meg-83tjwtg8dyz4vv7h1dqe`). Depuis
// l'IP du runtime Edge Supabase l'alias renvoie 404 (rate-limit / geo) alors
// qu'il marche en local. On hit l'id réel directement, fallback alias.
const ADEME_DATASET_IDS = ["meg-83tjwtg8dyz4vv7h1dqe", "dpe03existant"] as const;

async function fetchAdeme(input: ResolverInput): Promise<AdemeCert[]> {
  let res: Response | null = null;
  let lastStatus = 0;
  let lastUrl = "";
  for (const datasetId of ADEME_DATASET_IDS) {
    const url = new URL(`https://data.ademe.fr/data-fair/api/v1/datasets/${datasetId}/lines`);
    url.searchParams.set("size", "1000");
    url.searchParams.set("code_postal_ban_eq", input.postalCode);
    if (input.propertyType) {
      url.searchParams.set("type_batiment_eq", input.propertyType.toLowerCase());
    }
    url.searchParams.set(
      "select",
      "numero_dpe,adresse_ban,code_postal_ban,nom_commune_ban,_geopoint,surface_habitable_logement,type_batiment,etiquette_dpe,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,etiquette_ges,annee_construction,date_etablissement_dpe",
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
    const surface = r.surface_habitable_logement as number | undefined;
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
    });
  }
  return out;
}

function asLetter(v: unknown): ResolverInput["dpeClass"] {
  if (typeof v !== "string") return undefined;
  const up = v.trim().toUpperCase();
  if (["A", "B", "C", "D", "E", "F", "G"].includes(up)) return up as ResolverInput["dpeClass"];
  return undefined;
}

interface Scored {
  cert: AdemeCert;
  confidence: number;
  breakdown: { criterion: string; weight: number; matched: boolean }[];
}

function within(v: number, target: number, tolPct: number): boolean {
  return Math.abs(v - target) <= (Math.abs(target) * tolPct) / 100;
}

function rank(input: ResolverInput, certs: AdemeCert[]): Scored[] {
  const out: Scored[] = [];
  for (const cert of certs) {
    if (input.surface != null && !within(cert.surface, input.surface, 15)) continue;
    out.push(score(input, cert));
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function score(input: ResolverInput, cert: AdemeCert): Scored {
  const breakdown: Scored["breakdown"] = [];
  let scored = 0;
  let total = 0;
  const push = (criterion: string, weight: number, matched: boolean) => {
    total += weight;
    if (matched) scored += weight;
    breakdown.push({ criterion, weight, matched });
  };
  if (input.surface != null) push("surface", WEIGHTS.surface, within(cert.surface, input.surface, 5));
  // DPE — numérique préféré, fallback lettre (exclusif).
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null)
    push("dpeKwhM2", WEIGHTS.dpeKwhM2, within(cert.dpeKwhM2, input.dpeKwhM2, 10));
  else if (input.dpeClass && cert.dpeClass)
    push("dpeClass", WEIGHTS.dpeClass, input.dpeClass === cert.dpeClass);
  // GES — numérique préféré, fallback lettre (exclusif, même mécanique).
  if (input.gesKgCO2M2 != null && cert.gesKgCO2M2 != null)
    push("gesKgCO2M2", WEIGHTS.gesKgCO2M2, within(cert.gesKgCO2M2, input.gesKgCO2M2, 15));
  else if (input.gesClass && cert.gesClass)
    push("gesClass", WEIGHTS.gesClass, input.gesClass === cert.gesClass);
  if (input.yearBuilt != null && cert.yearBuilt != null)
    push("yearBuilt", WEIGHTS.yearBuilt, Math.abs(input.yearBuilt - cert.yearBuilt) <= 3);
  // Surface du terrain — maisons uniquement, contenance cadastrale résolue.
  if (input.landSurface != null && cert.landSurface != null && input.propertyType === "Maison")
    push("landSurface", WEIGHTS.landSurface, within(cert.landSurface, input.landSurface, 10));
  // Date du DPE — tie-break léger, seulement si les deux dates sont parsables.
  if (input.dpeDate && cert.dpeDate) {
    const ta = Date.parse(input.dpeDate);
    const tb = Date.parse(cert.dpeDate);
    if (Number.isFinite(ta) && Number.isFinite(tb))
      push("dpeDate", WEIGHTS.dpeDate, Math.abs(ta - tb) <= 60 * 86_400_000);
  }
  if (input.propertyType && cert.buildingType) {
    const expected = input.propertyType.toLowerCase();
    push(
      "buildingType",
      WEIGHTS.buildingType,
      cert.buildingType === expected ||
        (expected === "appartement" && cert.buildingType === "immeuble"),
    );
  }
  return {
    cert,
    confidence: total === 0 ? 0 : Math.round((scored / total) * 100),
    breakdown,
  };
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
