import { citycodeFromLatLon, fetchCommuneSales, fetchCopropriete, fetchRisks } from "@empir/core";
import type { CoproprieteParcel } from "@empir/core";

/**
 * Caches mémoire (durée de vie du sidepanel) pour les appels d'enrichissement
 * partagés entre hooks : le code INSEE d'un point, les ventes DVF et les
 * risques Géorisques d'une commune. Sans eux, `useMarket` et `useRisks` refont
 * les mêmes requêtes (reverse-geocode identique, CSV DVF de plusieurs Mo
 * re-téléchargés) à chaque re-déclenchement d'analyse. Une promesse rejetée
 * est retirée du cache pour permettre un retry ; les caches sont bornés
 * (éviction du plus ancien) pour ne pas grossir sans limite quand on navigue
 * d'annonce en annonce sur beaucoup de communes.
 */

/** Mémoïse une fonction async dans une Map bornée (éviction du plus ancien). */
function memoized<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  keyOf: (...args: A) => string,
  maxEntries: number,
): (...args: A) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (...args: A) => {
    const key = keyOf(...args);
    let p = cache.get(key);
    if (!p) {
      p = fn(...args);
      cache.set(key, p);
      p.catch(() => cache.delete(key));
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    return p;
  };
}

/** Code INSEE de la commune au point donné, mémoïsé (~10 m près). */
export const cachedCitycode = memoized(
  citycodeFromLatLon,
  (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`,
  50,
);

/** Ventes DVF de la commune, mémoïsées par code INSEE (données volumineuses). */
export const cachedCommuneSales = memoized(fetchCommuneSales, (citycode) => citycode, 5);

/** Rapport de risques Géorisques de la commune, mémoïsé par code INSEE. */
export const cachedRisks = memoized(fetchRisks, (citycode) => citycode, 20);

/** Copropriété (RNIC) du bien, mémoïsée par IDU de parcelle. */
export const cachedCopropriete = memoized(
  (parcel: CoproprieteParcel) => fetchCopropriete(parcel),
  (parcel) => parcel.id,
  50,
);
