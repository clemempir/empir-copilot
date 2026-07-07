import type { CommuneInfo } from "../types";

const API_BASE = "https://geo.api.gouv.fr/communes";

export interface FetchCommuneInfoOptions {
  fetchFn?: typeof fetch;
}

/**
 * Code INSEE de la commune contenant un point (lat/lon) via geo.api.gouv.fr.
 * Nécessaire pour les fichiers DVF (indexés par code INSEE, ≠ code postal).
 * Retourne `null` si aucune commune trouvée. Erreur réseau → throw.
 */
export async function citycodeFromLatLon(
  lat: number,
  lon: number,
  opts: FetchCommuneInfoOptions = {},
): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${API_BASE}?lat=${lat}&lon=${lon}&fields=code`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`commune (reverse) geo.api.gouv.fr: HTTP ${res.status}`);
  const json = (await res.json()) as Array<{ code?: string }>;
  return Array.isArray(json) && json[0]?.code ? json[0].code : null;
}

/**
 * Code postal principal d'une commune nommée, cherchée dans le même
 * département qu'un code postal de référence (départage les homonymes).
 * Retourne `null` si introuvable ou en cas d'erreur réseau (best-effort).
 */
export async function postalCodeOfCity(
  city: string,
  referencePostalCode: string,
  opts: FetchCommuneInfoOptions = {},
): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const dept = referencePostalCode.slice(0, 2);
    const url = `${API_BASE}?nom=${encodeURIComponent(city)}&codeDepartement=${dept}&fields=nom,codesPostaux&boost=population&limit=1`;
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const rows = (await res.json()) as { nom?: string; codesPostaux?: string[] }[];
    return rows[0]?.codesPostaux?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Population et densité de la commune via geo.api.gouv.fr (sans clé).
 * `surface` est renvoyée en HECTARES → densité hab/km² = population / (surface / 100).
 * Erreur réseau ou réponse invalide → throw (le pipeline gère via allSettled).
 */
export async function fetchCommuneInfo(
  citycode: string,
  opts: FetchCommuneInfoOptions = {},
): Promise<CommuneInfo> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${API_BASE}/${encodeURIComponent(citycode)}?fields=nom,population,surface`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`commune geo.api.gouv.fr: HTTP ${res.status}`);
  const json = (await res.json()) as {
    nom?: string;
    population?: number;
    surface?: number;
  };
  if (
    !json.nom ||
    typeof json.population !== "number" ||
    typeof json.surface !== "number" ||
    json.surface <= 0
  ) {
    throw new Error(`commune geo.api.gouv.fr: réponse incomplète pour ${citycode}`);
  }
  return {
    nom: json.nom,
    population: json.population,
    densityPerKm2: Math.round(json.population / (json.surface / 100)),
  };
}
