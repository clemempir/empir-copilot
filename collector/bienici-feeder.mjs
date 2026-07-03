// ============================================================================
// EMPIR — Feeder Bien'ici (backbone autonome, cloud-safe)
// ----------------------------------------------------------------------------
// Pour chaque commune ciblée :
//   1. pagine l'API de recherche Bien'ici (filtrée maison/appartement/immeuble),
//   2. garde les annonces du bon code postal, dédup contre `seen`,
//   3. récupère la fiche riche (DPE chiffré, date, blurInfo) par annonce,
//   4. (optionnel) appelle ton résolveur d'adresse,
//   5. écrit un "dossier de cas" complet dans Supabase (table `cases`).
//
// L'API Bien'ici est publique et n'est PAS protégée par DataDome → OK en cloud
// (GitHub Action). NE PAS mettre Leboncoin ici (cf. note d'archi).
//
// Lancer en local :   node bienici-feeder.mjs
// Node >= 18 (fetch natif).  Aucune dépendance npm.
// ============================================================================

// ---------- Config via variables d'environnement ----------
const SUPABASE_URL      = env("SUPABASE_URL");          // https://xxxx.supabase.co
const SERVICE_KEY       = env("SUPABASE_SERVICE_KEY");  // service_role (écriture, server-side only)
const RESOLVE_ENDPOINT  = process.env.RESOLVE_ENDPOINT || ""; // ta edge function (optionnel)
const RESOLVE_AUTH      = process.env.RESOLVE_AUTH || "";     // header Authorization éventuel
const ALGO_VERSION      = process.env.ALGO_VERSION || "unknown";
const MAX_PER_RUN       = int(process.env.MAX_PER_RUN, 60);   // plafond d'annonces NOUVELLES par run
const MAX_PAGES         = int(process.env.MAX_PAGES, 12);     // garde-fou pagination
const PAGE_SIZE         = 50;
const DELAY_MS          = int(process.env.DELAY_MS, 1200);    // politesse entre requêtes
const TYPES             = ["house", "flat", "building"];      // PAS de terrain

// Communes ciblées (zoneId Bien'ici + code postal exact pour filtrer)
const COMMUNES = [
  { name: "Saint-Sever",    zoneId: "-75951",  postalCode: "40500" },
  { name: "Mont-de-Marsan", zoneId: "-150319", postalCode: "40000" },
];

// Map Bien'ici propertyType -> vocabulaire EMPIR
const TYPE_MAP = { house: "maison", flat: "appartement", building: "immeuble" };

// ---------- Helpers ----------
function env(k){ const v = process.env[k]; if(!v){ console.error(`✗ variable d'env manquante: ${k}`); process.exit(1);} return v; }
function int(v, d){ const n = parseInt(v,10); return Number.isFinite(n)? n : d; }
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const jitter = () => DELAY_MS + Math.floor(Math.random()*600);

async function biFetch(url){
  const r = await fetch(url, { headers: {
    "user-agent": "Mozilla/5.0 (compatible; empir-collector/0.1)",
    "accept": "application/json",
  }});
  if(!r.ok) throw new Error(`Bien'ici HTTP ${r.status}`);
  return r.json();
}

function searchUrl(zoneId, from){
  const filters = {
    size: PAGE_SIZE, from,
    filterType: "buy",
    propertyType: TYPES,
    newProperty: false,
    sortBy: "publicationDate", sortOrder: "desc",
    onTheMarketTypes: ["new","old"],
    zoneIdsByTypes: { zoneIds: [zoneId] },
  };
  return "https://www.bienici.com/realEstateAds.json?filters=" + encodeURIComponent(JSON.stringify(filters));
}

// ---------- Supabase REST (PostgREST), sans dépendance ----------
async function sb(path, opts={}){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(opts.headers||{}),
    },
  });
  if(!r.ok && r.status !== 409) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r;
}
async function alreadySeen(portal, listingId){
  const r = await sb(`seen?portal=eq.${portal}&listing_id=eq.${encodeURIComponent(listingId)}&select=listing_id`);
  const rows = await r.json();
  return rows.length > 0;
}
async function markSeen(portal, listingId){
  await sb(`seen`, { method:"POST", headers:{ Prefer:"resolution=ignore-duplicates" },
    body: JSON.stringify({ portal, listing_id: listingId }) });
}
async function upsertCase(c){
  await sb(`cases`, { method:"POST", headers:{ Prefer:"resolution=merge-duplicates" },
    body: JSON.stringify(c) });
}

// ---------- Mapping fiche Bien'ici -> dossier de cas ----------
function mapAd(ad){
  const blur = ad.blurInfo ? {
    lat: ad.blurInfo.position?.lat, lon: ad.blurInfo.position?.lon,
    radiusM: ad.blurInfo.radius, type: ad.blurInfo.type,
    precise: ad.blurInfo.type === "gps",
  } : null;

  const extracted = {
    propertyType: TYPE_MAP[ad.propertyType] || ad.propertyType,
    surface: ad.surfaceArea ?? null,
    rooms: ad.roomsQuantity ?? null,
    bedrooms: ad.bedroomsQuantity ?? null,
    landSurface: ad.landSurfaceArea ?? null,
    dpeClass: ad.energyClassification ?? null,
    dpeKwh: ad.energyValue ?? null,
    gesClass: ad.greenhouseGazClassification ?? null,
    gesVal: ad.greenhouseGazValue ?? null,
    dpeDate: ad.energyPerformanceDiagnosticDate ?? null,
    year: ad.yearOfConstruction ?? null,
    price: ad.price ?? null,
    city: ad.city ?? null,
    postalCode: ad.postalCode ?? null,
    description: ad.description ?? null,
    marker: blur,
  };

  return {
    id: `bi-${ad.id}`,
    portal: "bienici",
    listing_id: ad.id,
    listing_url: `https://www.bienici.com/annonce/vente/${ad.id}`,
    agency: ad.contactRelativeData?.agencyNameToDisplay ?? null,
    ref: ad.reference ?? null,
    property_type: extracted.propertyType,
    city: extracted.city,
    postal_code: extracted.postalCode,
    extracted,
    photos: (ad.photos||[]).map(p=>p.url).filter(Boolean).slice(0,12),
    snapshot: stripHeavy(ad),
    algo_version: ALGO_VERSION,
    status: "pending_resolution",
  };
}
// Allège le snapshot (on garde tout sauf les blobs inutiles)
function stripHeavy(ad){ const { photos, ...rest } = ad; return rest; }

// ---------- Résolution (optionnelle, via edge function resolve-address) ----------
// Contrat réel : POST { deviceHash, listingUrl, input: ResolverInput }
//              → { candidates: ResolvedAddress[], usage, debug }
// NB : par défaut on N'APPELLE PAS l'endpoint — la résolution se fait en local
// avec l'algo du repo (`pnpm resolve-pending`), sans quota et toujours à jour.
const TYPE_INPUT = { maison: "Maison", appartement: "Appartement", immeuble: "Immeuble" };
async function resolve(extracted, listingUrl){
  if(!RESOLVE_ENDPOINT) return null;
  try{
    const geo = extracted.marker?.lat != null && extracted.marker?.lon != null ? {
      lat: extracted.marker.lat, lon: extracted.marker.lon,
      radiusM: extracted.marker.radiusM, precise: extracted.marker.precise === true,
    } : undefined;
    const payload = {
      deviceHash: "collector",
      listingUrl,
      input: {
        postalCode: extracted.postalCode, city: extracted.city ?? undefined,
        surface: extracted.surface ?? undefined, rooms: extracted.rooms ?? undefined,
        landSurface: extracted.landSurface ?? undefined,
        yearBuilt: extracted.year ?? undefined,
        dpeClass: extracted.dpeClass ?? undefined, dpeKwhM2: extracted.dpeKwh ?? undefined,
        gesClass: extracted.gesClass ?? undefined, gesKgCO2M2: extracted.gesVal ?? undefined,
        dpeDate: extracted.dpeDate ?? undefined,
        propertyType: TYPE_INPUT[extracted.propertyType] ?? undefined,
        geo,
      },
    };
    const r = await fetch(RESOLVE_ENDPOINT, { method:"POST",
      headers:{ "content-type":"application/json", ...(RESOLVE_AUTH?{authorization:RESOLVE_AUTH}:{}) },
      body: JSON.stringify(payload) });
    if(!r.ok) throw new Error(`resolve HTTP ${r.status}`);
    const data = await r.json();
    const top = (data.candidates||[])[0] || null;
    return {
      resolved: top ? {
        address: top.address, lat: top.lat, lon: top.lon,
        confidence: top.confidence, status: top.status,
        ademeCertId: top.ademeCertId, parcelId: top.parcelId, flags: top.flags ?? [],
      } : { address:null, confidence:0, status:"unresolved" },
      candidates: (data.candidates||[]).map(c=>({ address:c.address, confidence:c.confidence,
        numero_dpe:c.ademeCertId, dist_m:c.distanceM ?? null })),
      score_breakdown: top?.matchBreakdown || [],
    };
  }catch(e){
    return { error: String(e.message||e) };
  }
}

// ---------- Boucle principale ----------
async function run(){
  let collected = 0;
  console.log(`▶ EMPIR collector Bien'ici — communes: ${COMMUNES.map(c=>c.name).join(", ")} | types: ${TYPES.join(",")}`);

  for(const com of COMMUNES){
    if(collected >= MAX_PER_RUN) break;
    console.log(`\n── ${com.name} (${com.postalCode}) ──`);

    for(let page=0; page<MAX_PAGES && collected<MAX_PER_RUN; page++){
      let res;
      try { res = await biFetch(searchUrl(com.zoneId, page*PAGE_SIZE)); }
      catch(e){ console.warn(`  ⚠ recherche page ${page}: ${e.message}`); break; }
      await sleep(jitter());

      const ads = res.realEstateAds || [];
      if(!ads.length) break;

      // garder uniquement la commune exacte + un type voulu
      const wanted = ads.filter(a => String(a.postalCode)===com.postalCode && TYPES.includes(a.propertyType));
      // si la page ne contient plus la commune ciblée, on arrête (Bien'ici a basculé sur le périmètre élargi)
      if(wanted.length === 0 && ads.every(a => String(a.postalCode)!==com.postalCode)) break;

      for(const ad of wanted){
        if(collected >= MAX_PER_RUN) break;
        if(await alreadySeen("bienici", ad.id)) continue;

        try{
          // fiche riche (garantit blurInfo + date DPE)
          const full = await biFetch(`https://www.bienici.com/realEstateAd.json?id=${encodeURIComponent(ad.id)}`);
          await sleep(jitter());

          // L'index de recherche renvoie aussi des annonces DÉJÀ RETIRÉES du
          // marché (vendues/expirées) : lien mort pour la revue → on les saute.
          if(full?.status?.onTheMarket === false){
            await markSeen("bienici", ad.id);
            console.log(`  ∅ hors marché, ignorée: ${ad.id}`);
            continue;
          }

          const c = mapAd(full);
          const r = await resolve(c.extracted, c.listing_url);
          if(r){
            if(r.error){ c.status="error"; c.error=r.error; }
            else { c.resolved=r.resolved; c.candidates=r.candidates; c.score_breakdown=r.score_breakdown;
                   c.status = r.resolved?.status || "unresolved"; }
          }
          await upsertCase(c);
          await markSeen("bienici", ad.id);
          collected++;
          console.log(`  + ${c.property_type} ${c.extracted.surface||"?"}m² — ${c.resolved?.address || c.status} [${collected}/${MAX_PER_RUN}]`);
        }catch(e){
          console.warn(`  ⚠ annonce ${ad.id}: ${e.message}`);
          await markSeen("bienici", ad.id); // on évite de buter dessus en boucle
        }
      }
    }
  }
  console.log(`\n✓ Terminé — ${collected} nouveaux cas collectés.`);
}

run().catch(e=>{ console.error("✗ Échec:", e); process.exit(1); });
