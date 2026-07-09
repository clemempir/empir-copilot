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
import { handleCorsPreflight, corsHeaders, jsonResponse as json } from "../_shared/cors.ts";

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
  agencyName?: string;
  agencyAddress?: string;
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

  // Position géocodée de l'agence (best-effort) : alimente le détecteur de
  // marqueur « centré agence » du résolveur. Inutile sans marqueur carte.
  const agencyGeo = body.listing.geo
    ? await geocodeAgency(body.listing.agencyAddress).catch(() => undefined)
    : undefined;

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
    agencyGeo,
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

  // 2. Enrichissements parallèles (best-effort, ne bloquent pas le retour).
  // Les risques Géorisques sont récupérés côté client (use-risks) : plus la
  // peine de les charger ici.
  const [plu, taxe, patrimoine] = await Promise.all([
    fetchPlu(lat, lon).catch(() => null),
    fetchTaxeFonciere(body.listing.location.postalCode).catch(() => null),
    fetchPatrimoine(lat, lon).catch(() => null),
  ]);

  return json({
    status: "ok",
    resolvedAddress: top,
    candidates: resolveData.candidates,
    enrichments: { plu, taxeFonciere: taxe, patrimoine },
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

/**
 * Géocode l'adresse de l'AGENCE (BAN) pour le détecteur de marqueur erroné.
 * N'accepte qu'un géocodage PRÉCIS (housenumber/street, score correct) : un
 * résultat « centre-ville » tomberait par hasard près des disques de floutage
 * centrés sur la commune et créerait des faux positifs.
 */
const agencyGeoCache = new Map<string, Promise<{ lat: number; lon: number } | undefined>>();

function geocodeAgency(
  address: string | undefined,
): Promise<{ lat: number; lon: number } | undefined> {
  if (!address) return Promise.resolve(undefined);
  // Une agence publie beaucoup d'annonces : on mémorise le géocodage de son
  // adresse tant que l'instance edge reste chaude.
  let cached = agencyGeoCache.get(address);
  if (!cached) {
    // Un échec réseau n'est pas mémorisé : on retentera au prochain appel.
    cached = geocodeAgencyUncached(address).catch(() => {
      agencyGeoCache.delete(address);
      return undefined;
    });
    agencyGeoCache.set(address, cached);
  }
  return cached;
}

async function geocodeAgencyUncached(
  address: string,
): Promise<{ lat: number; lon: number } | undefined> {
  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { type?: string; score?: number };
    }>;
  };
  const f = json.features?.[0];
  const coords = f?.geometry?.coordinates;
  const precision = f?.properties?.type;
  const score = f?.properties?.score ?? 0;
  if (!coords || (precision !== "housenumber" && precision !== "street") || score < 0.6) {
    return undefined;
  }
  return { lon: coords[0], lat: coords[1] };
}

async function fetchPlu(lat: number | undefined, lon: number | undefined): Promise<unknown> {
  if (lat == null || lon == null) return null;
  const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// Servitudes d'utilité publique surfaciques (module GPU) au point résolu : sert à
// détecter les zones patrimoniales soumises à l'Architecte des Bâtiments de France
// (AC1 abords MH, AC4 site patrimonial remarquable). Classification côté client.
async function fetchPatrimoine(lat: number | undefined, lon: number | undefined): Promise<unknown> {
  if (lat == null || lon == null) return null;
  const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
  const url = `https://apicarto.ign.fr/api/gpu/assiette-sup-s?geom=${geom}`;
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
