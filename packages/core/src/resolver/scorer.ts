import type { AdemeCertificate } from "./ademe";
import type { MatchBreakdownItem, ResolverInput } from "./types";

/**
 * Pondérations (somme 100) de chaque critère pour calculer la confiance qu'un
 * certificat ADEME corresponde au bien décrit dans l'annonce. La surface est
 * le critère le plus discriminant ; le DPE numérique vient ensuite (la lettre
 * seule étant fortement bruitée par les arrondis et les algorithmes 3CL).
 */
const WEIGHTS = {
  surface: 30,
  dpeKwhM2: 25,
  rooms: 0, // ADEME v2 n'expose pas le nb de pièces — désactivé
  yearBuilt: 15,
  gesKgCO2M2: 15,
  dpeClass: 10,
  buildingType: 5,
} as const;

/** Surfaces : ±5% considéré comme matchant (arrondis de saisie). */
const SURFACE_TOLERANCE_PCT = 5;
/** DPE numérique : ±10% (variation 3CL fréquente). */
const DPE_TOLERANCE_PCT = 10;
/** GES numérique : ±15% (plus volatile). */
const GES_TOLERANCE_PCT = 15;
/** Année de construction : ±3 ans (typo, période). */
const YEAR_TOLERANCE = 3;

function within(value: number, target: number, tolerancePct: number): boolean {
  const tol = (Math.abs(target) * tolerancePct) / 100;
  return Math.abs(value - target) <= tol;
}

export interface ScoredCertificate {
  cert: AdemeCertificate;
  /** 0-100. */
  confidence: number;
  breakdown: MatchBreakdownItem[];
}

export function scoreCertificate(
  input: ResolverInput,
  cert: AdemeCertificate,
): ScoredCertificate {
  const breakdown: MatchBreakdownItem[] = [];
  let scored = 0;
  let totalWeight = 0;

  // Surface
  if (input.surface != null) {
    totalWeight += WEIGHTS.surface;
    const matched = within(cert.surface, input.surface, SURFACE_TOLERANCE_PCT);
    if (matched) scored += WEIGHTS.surface;
    breakdown.push({
      criterion: "surface",
      weight: WEIGHTS.surface,
      matched,
      expected: input.surface,
      actual: cert.surface,
    });
  }

  // DPE numérique (préféré à la lettre)
  if (input.dpeKwhM2 != null && cert.dpeKwhM2 != null) {
    totalWeight += WEIGHTS.dpeKwhM2;
    const matched = within(cert.dpeKwhM2, input.dpeKwhM2, DPE_TOLERANCE_PCT);
    if (matched) scored += WEIGHTS.dpeKwhM2;
    breakdown.push({
      criterion: "dpeKwhM2",
      weight: WEIGHTS.dpeKwhM2,
      matched,
      expected: input.dpeKwhM2,
      actual: cert.dpeKwhM2,
    });
  } else if (input.dpeClass && cert.dpeClass) {
    // Fallback sur la lettre (DPE annoncé non numérique).
    totalWeight += WEIGHTS.dpeClass;
    const matched = input.dpeClass === cert.dpeClass;
    if (matched) scored += WEIGHTS.dpeClass;
    breakdown.push({
      criterion: "dpeClass",
      weight: WEIGHTS.dpeClass,
      matched,
      expected: input.dpeClass,
      actual: cert.dpeClass,
    });
  }

  // GES numérique
  if (input.gesKgCO2M2 != null && cert.gesKgCO2M2 != null) {
    totalWeight += WEIGHTS.gesKgCO2M2;
    const matched = within(cert.gesKgCO2M2, input.gesKgCO2M2, GES_TOLERANCE_PCT);
    if (matched) scored += WEIGHTS.gesKgCO2M2;
    breakdown.push({
      criterion: "gesKgCO2M2",
      weight: WEIGHTS.gesKgCO2M2,
      matched,
      expected: input.gesKgCO2M2,
      actual: cert.gesKgCO2M2,
    });
  }

  // Année de construction
  if (input.yearBuilt != null && cert.yearBuilt != null) {
    totalWeight += WEIGHTS.yearBuilt;
    const matched = Math.abs(input.yearBuilt - cert.yearBuilt) <= YEAR_TOLERANCE;
    if (matched) scored += WEIGHTS.yearBuilt;
    breakdown.push({
      criterion: "yearBuilt",
      weight: WEIGHTS.yearBuilt,
      matched,
      expected: input.yearBuilt,
      actual: cert.yearBuilt,
    });
  }

  // Type de bâtiment
  if (input.propertyType && cert.buildingType) {
    totalWeight += WEIGHTS.buildingType;
    const expectedType = input.propertyType.toLowerCase();
    const matched =
      cert.buildingType === expectedType ||
      (expectedType === "appartement" && cert.buildingType === "immeuble");
    if (matched) scored += WEIGHTS.buildingType;
    breakdown.push({
      criterion: "buildingType",
      weight: WEIGHTS.buildingType,
      matched,
      expected: input.propertyType,
      actual: cert.buildingType,
    });
  }

  const confidence = totalWeight === 0 ? 0 : Math.round((scored / totalWeight) * 100);
  return { cert, confidence, breakdown };
}

/**
 * Score tous les certificats, ne garde que ceux dont la surface est dans la
 * tolérance (critère bloquant), trie par confiance décroissante, et retourne
 * le top `limit`.
 */
export function rankCertificates(
  input: ResolverInput,
  certs: AdemeCertificate[],
  limit = 5,
): ScoredCertificate[] {
  const ranked: ScoredCertificate[] = [];
  for (const cert of certs) {
    // Filtre dur sur la surface si fournie — un écart >15% indique presque
    // toujours un bien différent.
    if (input.surface != null && !within(cert.surface, input.surface, 15)) continue;
    ranked.push(scoreCertificate(input, cert));
  }
  ranked.sort((a, b) => b.confidence - a.confidence);
  return ranked.slice(0, limit);
}
