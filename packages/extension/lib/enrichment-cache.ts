import { citycodeFromLatLon, fetchCommuneSales } from "@empir/core";

/**
 * Caches mémoire (durée de vie du sidepanel) pour les appels d'enrichissement
 * partagés entre hooks : le code INSEE d'un point et les ventes DVF d'une
 * commune. Sans eux, `useMarket` et `useRisks` refont les mêmes requêtes
 * (reverse-geocode identique, CSV DVF de plusieurs Mo re-téléchargés) à chaque
 * re-déclenchement d'analyse. Une promesse rejetée est retirée du cache pour
 * permettre un retry.
 */

const citycodeCache = new Map<string, Promise<string | null>>();

/** Code INSEE de la commune au point donné, mémoïsé (~10 m près). */
export function cachedCitycode(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let p = citycodeCache.get(key);
  if (!p) {
    p = citycodeFromLatLon(lat, lon);
    citycodeCache.set(key, p);
    p.catch(() => citycodeCache.delete(key));
  }
  return p;
}

const salesCache = new Map<string, ReturnType<typeof fetchCommuneSales>>();

/** Ventes DVF de la commune, mémoïsées par code INSEE. */
export function cachedCommuneSales(citycode: string): ReturnType<typeof fetchCommuneSales> {
  let p = salesCache.get(citycode);
  if (!p) {
    p = fetchCommuneSales(citycode);
    salesCache.set(citycode, p);
    p.catch(() => salesCache.delete(citycode));
  }
  return p;
}
