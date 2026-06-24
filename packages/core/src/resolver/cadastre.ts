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
  /** Section + numéro (`AB0042`). */
  section: string;
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
    id?: string;
    code_insee?: string;
    section?: string;
    numero?: string;
    contenance?: number;
  };
}

const APICARTO = "https://apicarto.ign.fr/api/cadastre/parcelle";

export async function lookupParcel(opts: LookupParcelOptions): Promise<Parcel | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  // apicarto accepte un GeoJSON Point en paramètre `geom`
  const geom = encodeURIComponent(
    JSON.stringify({ type: "Point", coordinates: [opts.lon, opts.lat] }),
  );
  const url = `${APICARTO}?geom=${geom}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`apicarto cadastre: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { features?: GeoJsonFeature[] };
  const feat = json.features?.[0];
  if (!feat) return null;
  const props = feat.properties;
  const id = props.id;
  const codeInsee = props.code_insee;
  const section = props.section && props.numero ? `${props.section}${props.numero}` : props.section;
  if (!id || !codeInsee || !section) return null;
  return { id, codeCommune: codeInsee, section, contenance: props.contenance };
}
