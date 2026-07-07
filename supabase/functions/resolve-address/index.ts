/**
 * resolve-address — résolution d'adresse à la manière de parcellai.re.
 *
 * POST { deviceHash, listingUrl, input: ResolverInput }
 *
 * Pipeline :
 *   1. Délègue à track-usage pour appliquer le quota
 *   2. Cache (table address_cache) — clé versionnée par RESOLVER_VERSION
 *   3. Résolution : import DIRECT de packages/core/src/resolver (source
 *      unique, testée par le corpus de régression — plus de réplique).
 *
 * Renvoie : { candidates: ResolvedAddress[], usage, debug }
 */
import { handleCorsPreflight, corsHeaders, jsonResponse as json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  resolveAddress,
  RESOLVER_VERSION,
  type ResolveDebug,
  type ResolvedAddress,
  type ResolverInput,
} from "../../../packages/core/src/resolver/index.ts";

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
    let counters: ResolveDebug = {
      ademeTotal: 0,
      keptAfterSurfaceFilter: 0,
      usedLandSurfacePass: false,
    };
    candidates = await resolveAddress(body.input, { onDebug: (d) => (counters = d) });
    debug = { ...counters, fromCache: false };
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
  // L'agence géocodée change le résultat (marqueur neutralisé ou non).
  const agencyBucket = input.agencyGeo
    ? `${input.agencyGeo.lat.toFixed(4)},${input.agencyGeo.lon.toFixed(4)}`
    : "_";
  return [
    // Version d'algo (exportée par le core, bumpée avec chaque changement de
    // logique) : invalide le cache au déploiement d'un nouvel algo.
    RESOLVER_VERSION,
    input.postalCode,
    bucket(input.surface, 2),
    bucket(input.dpeKwhM2, 20),
    bucket(input.gesKgCO2M2, 5),
    bucket(input.yearBuilt, 5),
    bucket(input.landSurface, 20),
    monthBucket(input.dpeDate),
    geoBucket,
    agencyBucket,
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
