// ============================================================================
// EMPIR — Plomberie partagée des scripts collector/ et scripts/
// ----------------------------------------------------------------------------
// Un seul endroit pour : lecture des variables d'env, client Supabase REST
// (PostgREST) sans dépendance npm, pause de politesse, et mapping « dossier de
// cas → entrée du résolveur » (utilisé par le feeder ET resolve-pending, pour
// qu'un nouveau champ du résolveur ne soit ajouté qu'une fois).
// Fichier .mjs volontairement : importable par les scripts plain-node (.mjs)
// comme par ceux lancés via tsx (.mts).
// ============================================================================

/** Variable d'environnement obligatoire — sort avec un message clair sinon. */
export function env(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ variable d'env manquante: ${k}`);
    process.exit(1);
  }
  return v;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sbConf = null;
function conf() {
  if (!sbConf) sbConf = { url: env("SUPABASE_URL"), key: env("SUPABASE_SERVICE_KEY") };
  return sbConf;
}

/**
 * Appel Supabase REST (PostgREST) authentifié service_role.
 * `extra.allow409` : tolère un conflit d'unicité (upsert best-effort).
 */
export async function sb(path, opts = {}, extra = {}) {
  const { url, key } = conf();
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok && !(extra.allow409 && r.status === 409)) {
    throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  }
  return r;
}

// ── Mapping dossier de cas → ResolverInput ──────────────────────────────────

const TYPE_INPUT = { maison: "Maison", appartement: "Appartement", immeuble: "Immeuble" };

/**
 * `extracted` (schéma commun des dossiers de cas, tous portails) → entrée du
 * résolveur d'adresse. Renvoie null si le code postal manque (irrésolvable).
 */
export function toResolverInput(x) {
  if (!x.postalCode) return null;
  const geo =
    x.marker?.lat != null && x.marker?.lon != null
      ? {
          lat: x.marker.lat,
          lon: x.marker.lon,
          radiusM: x.marker.radiusM,
          precise: x.marker.precise === true,
        }
      : undefined;
  return {
    postalCode: x.postalCode,
    city: x.city ?? undefined,
    surface: x.surface ?? undefined,
    rooms: x.rooms ?? undefined,
    landSurface: x.landSurface ?? undefined,
    yearBuilt: x.year ?? undefined,
    dpeClass: x.dpeClass ?? undefined,
    dpeKwhM2: x.dpeKwh ?? undefined,
    gesClass: x.gesClass ?? undefined,
    gesKgCO2M2: x.gesVal ?? undefined,
    dpeDate: x.dpeDate ?? undefined,
    propertyType: x.propertyType ? TYPE_INPUT[x.propertyType] : undefined,
    geo,
  };
}

/** Candidat du résolveur → ligne `candidates` du dossier de cas. */
export function toCandidateRow(c) {
  return {
    address: c.address,
    confidence: c.confidence,
    numero_dpe: c.ademeCertId,
    dist_m: c.distanceM ?? null,
  };
}
