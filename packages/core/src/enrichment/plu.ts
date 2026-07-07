import type { PluZone } from "../types.ts";

const API_BASE = "https://apicarto.ign.fr/api/gpu/zone-urba";

export interface PluExplanation {
  /** Catégorie en clair, ex. « Zone urbaine ». */
  category: string;
  /** Ce que ça implique pour l'acheteur (constructibilité). */
  meaning: string;
  /** Ton d'affichage : warn si constructibilité restreinte. */
  tone: "default" | "info" | "warn";
}

/**
 * Traduit le code de type de zone PLU (U / AU / A / N — standard national) en
 * légende compréhensible. Le `typezone` de l'API GPU suit cette nomenclature ;
 * on teste « AU » avant « A » (préfixe commun).
 */
export function explainPluZone(typezone?: string): PluExplanation {
  const t = (typezone ?? "").toUpperCase();
  if (t.startsWith("AU"))
    return {
      category: "Zone à urbaniser",
      meaning: "Réservée à l'urbanisation future — constructibilité souvent conditionnée à des aménagements.",
      tone: "info",
    };
  if (t.startsWith("U"))
    return {
      category: "Zone urbaine",
      meaning: "Secteur déjà bâti, constructible selon le règlement du PLU.",
      tone: "default",
    };
  if (t.startsWith("A"))
    return {
      category: "Zone agricole",
      meaning: "Constructions très limitées, réservées à l'activité agricole.",
      tone: "warn",
    };
  if (t.startsWith("N"))
    return {
      category: "Zone naturelle",
      meaning: "Secteur protégé, quasiment inconstructible.",
      tone: "warn",
    };
  return { category: "Zone PLU", meaning: "", tone: "default" };
}

export interface FetchPluZoneOptions {
  fetchFn?: typeof fetch;
}

/**
 * Zonage PLU au point via le Géoportail de l'Urbanisme (apicarto, sans clé).
 *
 * ⚠️ GET obligatoire : le POST de cette API IGNORE le filtre `geom` et renvoie
 * des zones arbitraires (vérifié empiriquement le 2026-06-11).
 * ⚠️ GeoJSON : coordinates dans l'ordre [longitude, latitude].
 *
 * Retourne null quand aucune zone ne couvre le point (commune sans PLU
 * numérisé ou point hors zonage) — ce n'est pas une erreur.
 * On ne conserve que `properties` (les géométries des features sont lourdes).
 */
export async function fetchPluZone(
  lat: number,
  lon: number,
  opts: FetchPluZoneOptions = {},
): Promise<PluZone | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const geom = JSON.stringify({ type: "Point", coordinates: [lon, lat] });
  const url = `${API_BASE}?geom=${encodeURIComponent(geom)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`zonage PLU apicarto: HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: { properties?: { libelle?: string; typezone?: string } }[];
  };
  const props = json.features?.[0]?.properties;
  if (!props?.libelle || !props.typezone) return null;
  return { libelle: props.libelle, typezone: props.typezone };
}
