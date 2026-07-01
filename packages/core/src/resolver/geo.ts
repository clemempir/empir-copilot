import type { GeoHint } from "./types";

/**
 * Distance approchée en mètres (équirectangulaire — suffisant à l'échelle d'une
 * commune) : dist ≈ √((dLat·111200)² + (dLon·cos(lat)·111320)²).
 */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111_200;
  const dLon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180) * 111_320;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Un marqueur est « précis » (point) plutôt qu'un disque de floutage si la
 * source le déclare (`gps`) ou si son rayon est absent / faible.
 */
export function isPreciseMarker(geo: GeoHint): boolean {
  if (geo.precise != null) return geo.precise;
  if (geo.precision === "gps") return true;
  if (geo.precision === "disk") return false;
  return geo.radiusM == null || geo.radiusM <= 50;
}

/**
 * Coefficient géo multiplicatif « échelle km » (façon parcellai.re) appliqué à
 * un score attributaire pour un marqueur-DISQUE (non précis) : neutre (1) dans
 * le rayon, décroît linéairement jusqu'à 0 à 2× le rayon.
 */
export function geoDiskCoef(distanceM: number | undefined, radiusM: number): number {
  if (distanceM == null) return 1; // cert sans position : pas de pénalité
  if (distanceM <= radiusM) return 1;
  const coef = 1 - (distanceM - radiusM) / radiusM;
  return coef < 0 ? 0 : coef;
}
