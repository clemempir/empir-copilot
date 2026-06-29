import type { AdemeCertificate } from "./ademe";
import type { MatchBreakdownItem, ResolverInput } from "./types";

/**
 * Pondérations (somme ≈ 100 sur le chemin "tout numérique") de chaque critère
 * pour calculer la confiance qu'un certificat ADEME corresponde au bien décrit
 * dans l'annonce. La surface reste le critère le plus discriminant ; le DPE et le
 * GES numériques priment sur leurs lettres (fortement bruitées par les arrondis
 * et l'algo 3CL), mais retombent sur la lettre quand le chiffre manque.
 *
 * ⚠️ Réplique manuelle dans `supabase/functions/resolve-address/index.ts` —
 * propager tout changement (cf. commentaire de ce fichier).
 */
const WEIGHTS = {
  surface: 28,
  dpeKwhM2: 22,
  dpeClass: 8, // fallback DPE lettre (exclusif avec dpeKwhM2)
  gesKgCO2M2: 12,
  gesClass: 7, // fallback GES lettre (exclusif avec gesKgCO2M2)
  yearBuilt: 11,
  landSurface: 7, // maisons uniquement (contenance cadastrale)
  dpeDate: 5,
  buildingType: 5,
  rooms: 0, // ADEME v2 n'expose pas le nb de pièces — désactivé
} as const;

/** Surfaces habitables : ±5% considéré comme matchant (arrondis de saisie). */
const SURFACE_TOLERANCE_PCT = 5;
/** DPE numérique : ±10% (variation 3CL fréquente). */
const DPE_TOLERANCE_PCT = 10;
/** GES numérique : ±15% (plus volatile). */
const GES_TOLERANCE_PCT = 15;
/** Surface du terrain : ±10% (contenance cadastrale vs surface annoncée). */
const LAND_SURFACE_TOLERANCE_PCT = 10;
/** Année de construction : ±3 ans (typo, période). */
const YEAR_TOLERANCE = 3;
/** Date du DPE : ±60 jours (tie-break). */
const DPE_DATE_TOLERANCE_DAYS = 60;

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

  // Surface habitable
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

  // DPE — numérique préféré, fallback lettre (exclusif).
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

  // GES — numérique préféré, fallback lettre (exclusif, même mécanique que le DPE).
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
  } else if (input.gesClass && cert.gesClass) {
    totalWeight += WEIGHTS.gesClass;
    const matched = input.gesClass === cert.gesClass;
    if (matched) scored += WEIGHTS.gesClass;
    breakdown.push({
      criterion: "gesClass",
      weight: WEIGHTS.gesClass,
      matched,
      expected: input.gesClass,
      actual: cert.gesClass,
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

  // Surface du terrain — discriminant pour les maisons uniquement, et seulement
  // si la contenance cadastrale a été résolue (cf. passe 2 du résolveur).
  if (
    input.landSurface != null &&
    cert.landSurface != null &&
    input.propertyType === "Maison"
  ) {
    totalWeight += WEIGHTS.landSurface;
    const matched = within(cert.landSurface, input.landSurface, LAND_SURFACE_TOLERANCE_PCT);
    if (matched) scored += WEIGHTS.landSurface;
    breakdown.push({
      criterion: "landSurface",
      weight: WEIGHTS.landSurface,
      matched,
      expected: input.landSurface,
      actual: cert.landSurface,
    });
  }

  // Date du DPE — tie-break léger (ne compte que si les deux dates sont parsables).
  if (input.dpeDate && cert.dpeDate) {
    const ta = Date.parse(input.dpeDate);
    const tb = Date.parse(cert.dpeDate);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      totalWeight += WEIGHTS.dpeDate;
      const matched = Math.abs(ta - tb) <= DPE_DATE_TOLERANCE_DAYS * 86_400_000;
      if (matched) scored += WEIGHTS.dpeDate;
      breakdown.push({
        criterion: "dpeDate",
        weight: WEIGHTS.dpeDate,
        matched,
        expected: input.dpeDate,
        actual: cert.dpeDate,
      });
    }
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
