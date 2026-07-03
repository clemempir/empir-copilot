// ============================================================================
// EMPIR — Ingestion SeLoger : raw_pages (HTML déposé par le navigateur) → cases
// ----------------------------------------------------------------------------
// SeLoger est protégé par DataDome : la collecte passe par un VRAI navigateur
// qui dépose le HTML brut dans `raw_pages`. Ce script (local) :
//   1. lit les pages en attente,
//   2. les parse avec le parseur officiel du repo (parseSelogerHtml),
//   3. écrit un dossier de cas `portal=seloger` (même schéma que Bien'ici),
//   4. purge la page brute.
// Puis lancer `pnpm resolve-pending` pour résoudre les nouveaux cas.
//
// Usage : SUPABASE_URL=… SUPABASE_SERVICE_KEY=… pnpm ingest-seloger
// ============================================================================
import { parseSelogerHtml, type Listing } from "../packages/core/src/index";

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_KEY");

function env(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ variable d'env manquante: ${k}`);
    process.exit(1);
  }
  return v;
}

async function sb(path: string, opts: RequestInit = {}): Promise<Response> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r;
}

/** Listing (parseur core) → dossier de cas (même schéma extracted que Bien'ici). */
function toCase(l: Listing, url: string) {
  const idMatch = url.match(/(\d+)(?:\.htm|\/detail\.htm)/);
  const listingId = idMatch?.[1] ?? url.replace(/\W+/g, "-");
  const marker = l.geo
    ? {
        lat: l.geo.lat,
        lon: l.geo.lon,
        radiusM: l.geo.radiusM,
        type: l.geo.precise ? "gps" : "disk",
        precise: l.geo.precise === true,
      }
    : null;
  return {
    id: `sl-${listingId}`,
    portal: "seloger",
    listing_id: listingId,
    listing_url: url,
    agency: null,
    ref: null,
    property_type: l.propertyType?.toLowerCase() ?? null,
    city: l.location?.city ?? null,
    postal_code: l.location?.postalCode ?? null,
    extracted: {
      propertyType: l.propertyType?.toLowerCase() ?? null,
      surface: l.surface ?? null,
      rooms: l.rooms ?? null,
      bedrooms: l.bedrooms ?? null,
      landSurface: l.landSurface ?? null,
      dpeClass: l.dpe ?? null,
      dpeKwh: l.dpeKwhM2 ?? null,
      gesClass: l.ges ?? null,
      gesVal: l.gesKgCO2M2 ?? null,
      dpeDate: l.dpeDate ?? null,
      year: null, // non exposé par le parseur SeLoger (dans attributes le cas échéant)
      price: l.price ?? null,
      city: l.location?.city ?? null,
      postalCode: l.location?.postalCode ?? null,
      description: l.description ?? null,
      marker,
    },
    photos: (l.photos ?? []).slice(0, 12),
    snapshot: { title: l.title, attributes: l.attributes ?? [], publishedAt: l.publishedAt ?? null },
    status: "pending_resolution",
  };
}

async function run(): Promise<void> {
  const r = await sb(`raw_pages?portal=eq.seloger&select=id,url,html&order=created_at.asc&limit=100`);
  const rows = (await r.json()) as { id: string; url: string; html: string }[];
  console.log(`▶ ${rows.length} page(s) SeLoger à ingérer`);

  let ok = 0;
  for (const row of rows) {
    try {
      const listing = parseSelogerHtml(row.html, row.url);
      const c = toCase(listing, row.url);
      // Terrain / type inconnu sans surface : hors périmètre du banc d'essai.
      if (!c.extracted.surface || !c.extracted.postalCode) {
        console.log(`  ∅ ignorée (surface/CP manquant): ${row.id}`);
      } else {
        await sb(`cases`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(c),
        });
        await sb(`seen`, {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({ portal: "seloger", listing_id: c.listing_id }),
        });
        ok++;
        console.log(
          `  + ${c.extracted.propertyType} ${c.extracted.surface}m² DPE ${c.extracted.dpeClass ?? "?"}/${c.extracted.dpeKwh ?? "?"} · marqueur ${c.extracted.marker ? (c.extracted.marker.precise ? "précis" : `disque ${c.extracted.marker.radiusM ?? "?"}m`) : "—"} · ${c.id}`,
        );
      }
    } catch (e) {
      console.warn(`  ⚠ parse ${row.id}: ${String((e as Error).message ?? e)}`);
    }
    // Purge la page brute (parsée ou irrécupérable).
    await sb(`raw_pages?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
  }
  console.log(`\n✓ Terminé — ${ok} cas SeLoger créés. Lancer : pnpm resolve-pending`);
}

run().catch((e) => {
  console.error("✗ Échec:", e);
  process.exit(1);
});
