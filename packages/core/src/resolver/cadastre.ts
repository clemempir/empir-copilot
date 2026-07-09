/**
 * Wrapper sur apicarto.ign.fr — service public IGN pour le cadastre.
 *
 * Endpoint : https://apicarto.ign.fr/api/cadastre/parcelle
 * - Aucune clé requise (limite usage raisonnable)
 * - Réponse GeoJSON FeatureCollection
 *
 * Permet d'attribuer une référence parcellaire (`id`) à un point lat/lon,
 * augmentant la confiance d'un match d'adresse.
 */

export interface Parcel {
  /** Identifiant cadastral national (`75103000AB0042`). */
  id: string;
  /** Code commune INSEE. */
  codeCommune: string;
  /** Section (`CL`). */
  section: string;
  /** Numéro de parcelle sans zéros de tête (`96`). */
  numero: string;
  /** Surface de la parcelle en m². */
  contenance?: number;
}

export interface LookupParcelOptions {
  lat: number;
  lon: number;
  fetchFn?: typeof fetch;
}

interface GeoJsonFeature {
  properties: {
    // apicarto expose l'identifiant sous `idu` (et non `id`).
    idu?: string;
    code_insee?: string;
    section?: string;
    numero?: string;
    contenance?: number;
  };
  geometry?: {
    type: string;
    coordinates: unknown;
  };
}

const APICARTO = "https://apicarto.ign.fr/api/cadastre/parcelle";

export async function lookupParcel(opts: LookupParcelOptions): Promise<Parcel | null> {
  const fetchFn = opts.fetchFn ?? fetch;

  // 1) Requête au point exact.
  let features = await queryCadastre(fetchFn, {
    type: "Point",
    coordinates: [opts.lon, opts.lat],
  });

  // 2) Fallback : le géocodeur pose souvent le point sur l'axe de la voie, où
  //    apicarto ne renvoie AUCUNE parcelle (réponse parfois instable au même
  //    point). On rejoue avec un petit carré tampon (~5 m) autour du point et
  //    on retient la parcelle dont le centroïde est le plus proche.
  if (features.length === 0) {
    features = await queryCadastre(fetchFn, squareBuffer(opts.lon, opts.lat, 5));
    const nearest = nearestFeature(features, opts.lon, opts.lat);
    features = nearest ? [nearest] : [];
  }

  const props = features[0]?.properties;
  if (!props) return null;
  const id = props.idu;
  const codeInsee = props.code_insee;
  const section = props.section;
  const numero = props.numero;
  if (!id || !codeInsee || !section || !numero) return null;
  return {
    id,
    codeCommune: codeInsee,
    section,
    numero: numero.replace(/^0+(?=\d)/, ""),
    contenance: props.contenance,
  };
}

// Interroge apicarto avec une géométrie GeoJSON ; renvoie les features (jamais throw sur 404).
async function queryCadastre(
  fetchFn: typeof fetch,
  geom: object,
): Promise<GeoJsonFeature[]> {
  const url = `${APICARTO}?geom=${encodeURIComponent(JSON.stringify(geom))}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`apicarto cadastre: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { features?: GeoJsonFeature[] };
  return json.features ?? [];
}

// Carré (Polygon GeoJSON) d'environ `metres` de côté centré sur le point.
function squareBuffer(lon: number, lat: number, metres: number): object {
  const half = metres / 2;
  const dLat = half / 111_320;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

// Parmi plusieurs parcelles, celle dont le centroïde est le plus proche du point.
function nearestFeature(
  features: GeoJsonFeature[],
  lon: number,
  lat: number,
): GeoJsonFeature | null {
  let best: GeoJsonFeature | null = null;
  let bestDist = Infinity;
  for (const f of features) {
    const c = centroid(f.geometry);
    if (!c) continue;
    const d = (c[0] - lon) ** 2 + (c[1] - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best ?? features[0] ?? null;
}

// Centroïde grossier (moyenne des sommets de l'anneau extérieur).
function centroid(geometry: GeoJsonFeature["geometry"]): [number, number] | null {
  if (!geometry) return null;
  let ring: number[][] | undefined;
  if (geometry.type === "Polygon") ring = (geometry.coordinates as number[][][])[0];
  else if (geometry.type === "MultiPolygon") ring = (geometry.coordinates as number[][][][])[0]?.[0];
  if (!ring || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const pt of ring) {
    sx += pt[0] ?? 0;
    sy += pt[1] ?? 0;
  }
  return [sx / ring.length, sy / ring.length];
}
