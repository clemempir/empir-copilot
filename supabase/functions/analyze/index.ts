/**
 * analyze — orchestrateur principal d'EMPIR.
 *
 * POST { deviceHash, listing }   // listing = objet @empir/core/Listing
 *
 * Pipeline :
 *   1. Appelle resolve-address (qui inclut le quota usage)
 *   2. Enrichit en parallèle : DVF comparables, Géorisques, PLU, taxe foncière,
 *      commune info (réplique des wrappers de @empir/core, ou proxy)
 *   3. Renvoie un rapport complet pour le sidepanel
 *
 * V1 minimale : retourne candidates + données brutes ; le sidepanel calcule
 * le score prix (réutilise buildQuickAnalysis côté client). Les enrichissements
 * Géorisques/PLU/taxe sont appelés best-effort en parallèle.
 */
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";

interface Listing {
  url: string;
  surface?: number;
  price: number;
  rooms?: number;
  bedrooms?: number;
  landSurface?: number;
  propertyType?: "Appartement" | "Maison" | "Immeuble";
  location: {
    postalCode?: string;
    city?: string;
    lat?: number;
    lon?: number;
  };
  dpe?: string;
  ges?: string;
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
  dpeDate?: string;
  apartmentCount?: number;
  geo?: { lat: number; lon: number; radiusM?: number; precision?: "gps" | "disk" };
  attributes?: { label: string; value: string }[];
}

interface AnalyzeBody {
  deviceHash: string;
  listing: Listing;
}

Deno.serve(async (req: Request) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as AnalyzeBody | null;
  if (!body?.deviceHash || !body.listing?.location?.postalCode) {
    return json({ error: "missing_fields" }, 400);
  }

  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // Entrée du résolveur, dérivée de l'annonce — échoée dans `debug` pour le
  // diagnostic côté sidepanel.
  const resolverInput = {
    postalCode: body.listing.location.postalCode,
    city: body.listing.location.city,
    surface: body.listing.surface,
    rooms: body.listing.rooms,
    landSurface: body.listing.landSurface,
    propertyType: body.listing.propertyType,
    dpeClass: parseDpe(body.listing.dpe),
    dpeKwhM2: body.listing.dpeKwhM2,
    gesKgCO2M2: body.listing.gesKgCO2M2,
    gesClass: parseDpe(body.listing.ges),
    dpeDate: body.listing.dpeDate,
    apartmentCount: body.listing.apartmentCount,
    geo: body.listing.geo,
    yearBuilt: extractYearBuilt(body.listing.attributes),
  };

  // 1. resolve-address (inclut le quota)
  const resolveRes = await fetch(`${baseUrl}/functions/v1/resolve-address`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
      apikey: anon,
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
    body: JSON.stringify({
      deviceHash: body.deviceHash,
      listingUrl: body.listing.url,
      input: resolverInput,
    }),
  });
  const resolveData = (await resolveRes.json()) as {
    candidates: { lat: number; lon: number; address: string; confidence: number }[];
    usage: { used: number; limit: number; allowed: boolean; plan: string };
    debug?: Record<string, unknown>;
  };

  if (!resolveData.usage.allowed) {
    return json({ status: "quota_exceeded", usage: resolveData.usage });
  }

  const top = resolveData.candidates[0];
  const lat = top?.lat ?? body.listing.location.lat;
  const lon = top?.lon ?? body.listing.location.lon;

  // 2. Enrichissements parallèles (best-effort, ne bloquent pas le retour)
  const [risks, plu, taxe] = await Promise.all([
    fetchGeorisques(lat, lon).catch(() => null),
    fetchPlu(lat, lon).catch(() => null),
    fetchTaxeFonciere(body.listing.location.postalCode).catch(() => null),
  ]);

  return json({
    status: "ok",
    resolvedAddress: top,
    candidates: resolveData.candidates,
    enrichments: { risks, plu, taxeFonciere: taxe },
    usage: resolveData.usage,
    debug: { resolverInput, ...(resolveData.debug ?? {}) },
  });
});

function parseDpe(s: string | undefined): "A" | "B" | "C" | "D" | "E" | "F" | "G" | undefined {
  if (!s) return undefined;
  const m = s.trim().toUpperCase();
  if (["A", "B", "C", "D", "E", "F", "G"].includes(m)) return m as "A";
  return undefined;
}

function extractYearBuilt(
  attrs: { label: string; value: string }[] | undefined,
): number | undefined {
  if (!attrs) return undefined;
  for (const a of attrs) {
    const l = a.label.toLowerCase();
    if (l.includes("année") || l.includes("construction") || l.includes("bâti")) {
      const n = parseInt(a.value.replace(/\D+/g, ""), 10);
      if (n >= 1800 && n <= new Date().getFullYear()) return n;
    }
  }
  return undefined;
}

async function fetchGeorisques(lat: number | undefined, lon: number | undefined): Promise<unknown> {
  if (lat == null || lon == null) return null;
  const url = `https://www.georisques.gouv.fr/api/v1/gaspar/risques?rayon=10&latlon=${lon},${lat}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchPlu(lat: number | undefined, lon: number | undefined): Promise<unknown> {
  if (lat == null || lon == null) return null;
  const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchTaxeFonciere(postalCode: string | undefined): Promise<unknown> {
  if (!postalCode) return null;
  const url = `https://data.economie.gouv.fr/api/records/1.0/search/?dataset=impots-locaux&q=&refine.code_postal=${postalCode}&rows=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
