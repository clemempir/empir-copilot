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
  landSurface?: number;
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
  return [
    input.postalCode,
    bucket(input.surface, 2),
    bucket(input.dpeKwhM2, 20),
    bucket(input.yearBuilt, 5),
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
  surface: 30,
  dpeKwhM2: 25,
  yearBuilt: 15,
  gesKgCO2M2: 15,
  dpeClass: 10,
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
  yearBuilt?: number;
}

async function resolveAddress(input: ResolverInput): Promise<ResolvedAddress[]> {
  const certs = await fetchAdeme(input);
  const ranked = rank(input, certs).slice(0, 5);

  const out: ResolvedAddress[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const { cert, confidence, breakdown } = ranked[i]!;
    let parcelId: string | undefined;
    if (i === 0 && cert.lat != null && cert.lon != null) {
      parcelId = (await lookupParcel(cert.lat, cert.lon)) ?? undefined;
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

async function fetchAdeme(input: ResolverInput): Promise<AdemeCert[]> {
  const qs: string[] = [`code_postal_ban:"${input.postalCode}"`];
  if (input.propertyType) qs.push(`type_batiment:"${input.propertyType.toLowerCase()}"`);

  const url = new URL("https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines");
  url.searchParams.set("size", "1000");
  url.searchParams.set("qs", qs.join(" AND "));
  url.searchParams.set(
    "select",
    "numero_dpe,adresse_ban,code_postal_ban,nom_commune_ban,ban_x,ban_y,surface_habitable_logement,type_batiment,etiquette_dpe,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,etiquette_ges,annee_construction",
  );
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`ADEME ${res.status}`);
  const json = (await res.json()) as { results?: Record<string, unknown>[] };
  const out: AdemeCert[] = [];
  for (const r of json.results ?? []) {
    const certId = (r.numero_dpe as string | undefined) ?? "";
    const surface = r.surface_habitable_logement as number | undefined;
    if (!certId || surface == null) continue;
    out.push({
      certId,
      address: (r.adresse_ban as string) ?? "",
      lat: (r.ban_y as number | undefined) ?? undefined,
      lon: (r.ban_x as number | undefined) ?? undefined,
      surface,
      buildingType: (r.type_batiment as string | undefined)?.toLowerCase(),
      dpeClass: asLetter(r.etiquette_dpe),
      dpeKwhM2: r.conso_5_usages_par_m2_ep as number | undefined,
      gesKgCO2M2: r.emission_ges_5_usages_par_m2 as number | undefined,
      yearBuilt: (r.annee_construction as number | undefined) || undefined,
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
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null)
    push("dpeKwhM2", WEIGHTS.dpeKwhM2, within(cert.dpeKwhM2, input.dpeKwhM2, 10));
  else if (input.dpeClass && cert.dpeClass)
    push("dpeClass", WEIGHTS.dpeClass, input.dpeClass === cert.dpeClass);
  if (input.gesKgCO2M2 != null && cert.gesKgCO2M2 != null)
    push("gesKgCO2M2", WEIGHTS.gesKgCO2M2, within(cert.gesKgCO2M2, input.gesKgCO2M2, 15));
  if (input.yearBuilt != null && cert.yearBuilt != null)
    push("yearBuilt", WEIGHTS.yearBuilt, Math.abs(input.yearBuilt - cert.yearBuilt) <= 3);
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

async function lookupParcel(lat: number, lon: number): Promise<string | null> {
  try {
    const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
    const res = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { features?: { properties: { id?: string } }[] };
    return json.features?.[0]?.properties?.id ?? null;
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
