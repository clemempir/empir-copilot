import type { AdemeCertificate } from "./ademe";
import type { MatchBreakdownItem, ResolverInput } from "./types";

/**
 * SCORING ADAPTATIF — « selectivity-weighted ».
 *
 * Le score d'un certificat n'est plus une somme de poids fixes mais :
 *
 *     score(c) = Σ_k  w_k · sim_k(c) · selectivity_k
 *
 *   • w_k          = fiabilité intrinsèque du critère (constante ci-dessous).
 *   • sim_k(c)     ∈ [0,1] = concordance continue : 1 dans la tolérance serrée,
 *                  décroît linéairement jusqu'à 0 au bord de la tolérance max.
 *   • selectivity_k = pouvoir discriminant LOCAL : rareté de la valeur de
 *                  l'annonce parmi le vivier P (les certs de la commune) :
 *                      selectivity_k = -ln( (1 + #{c'∈P : sim_k(c')=1}) / (1+|P|) )
 *                  ≈ 0 si tout le monde partage la valeur (inutile pour trancher),
 *                  grand si la valeur est rare (très discriminante).
 *
 * Conséquences voulues :
 *   – un critère manquant ou non concordant contribue 0 (jamais de pénalité) ;
 *   – une valeur rare et concordante (date de DPE, conso précise) domine
 *     naturellement, sans pondération ad hoc ;
 *   – le score est additif → robuste aux DPE immeuble / lots (la surface qui
 *     diverge contribue juste 0 au lieu d'éliminer le candidat).
 *
 * ⚠️ Réplique manuelle dans `supabase/functions/resolve-address/index.ts`.
 */

/** Fiabilité intrinsèque w_k (constantes). */
const W = {
  dpeKwhM2: 0.9,
  surface: 0.85,
  dpeDate: 0.85,
  gesKgCO2M2: 0.6,
  yearBuilt: 0.5,
  landSurface: 0.5,
  apartmentCount: 0.5,
  dpeClass: 0.35,
  gesClass: 0.3,
  buildingType: 0.25,
} as const;

/** Seuil de similarité considéré comme « concordant » (tolérance serrée). */
const SIM_MATCH = 0.999;
/** Seuil de sélectivité « forte » (critère vraiment discriminant localement). */
export const SELECTIVITY_STRONG = 1.0;
const MS_PER_DAY = 86_400_000;

// ── Fonctions de similarité ────────────────────────────────────────────────

/** Similarité pour une valeur numérique avec tolérances en pourcentage. */
function simPct(value: number, target: number, tightPct: number, maxPct: number): number {
  const diff = Math.abs(value - target);
  const tight = (Math.abs(target) * tightPct) / 100;
  const max = (Math.abs(target) * maxPct) / 100;
  if (diff <= tight) return 1;
  if (diff >= max) return 0;
  return (max - diff) / (max - tight);
}

/** Similarité pour un écart absolu (années, jours) avec tolérances absolues. */
function simAbs(diff: number, tight: number, max: number): number {
  if (diff <= tight) return 1;
  if (diff >= max) return 0;
  return (max - diff) / (max - tight);
}

function parseDay(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Similarité « date DPE » : min des écarts à date_etablissement ET date_visite. */
function simDate(input: ResolverInput, cert: AdemeCertificate): number | null {
  const target = parseDay(input.dpeDate);
  if (target == null) return null;
  const cands = [parseDay(cert.dpeDate), parseDay(cert.dpeVisitDate)].filter(
    (v): v is number => v != null,
  );
  if (!cands.length) return null;
  const bestDays = Math.min(...cands.map((t) => Math.abs(target - t))) / MS_PER_DAY;
  return simAbs(bestDays, 3, 10);
}

function buildingTypeSim(input: ResolverInput, cert: AdemeCertificate): number | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison" ? 1 : 0;
  // appartement ≈ immeuble (un appart appartient à un immeuble)
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble" ? 1 : 0;
}

// ── Définition des critères actifs (résout l'exclusivité DPE/GES) ──────────

interface CritDef {
  key: string;
  weight: number;
  expected: string | number;
  /** Similarité du certificat, ou `null` si le critère n'est pas évaluable pour lui. */
  sim(cert: AdemeCertificate): number | null;
  /** Valeur du certificat (pour le breakdown). */
  actual(cert: AdemeCertificate): string | number | undefined;
}

function activeCriteria(input: ResolverInput): CritDef[] {
  const crits: CritDef[] = [];

  if (input.surface != null) {
    const target = input.surface;
    crits.push({
      key: "surface",
      weight: W.surface,
      expected: target,
      sim: (c) => simPct(c.surface, target, 5, 15),
      actual: (c) => c.surface,
    });
  }

  // DPE — numérique préféré, fallback lettre (exclusif).
  if (input.dpeKwhM2 != null) {
    const target = input.dpeKwhM2;
    crits.push({
      key: "dpeKwhM2",
      weight: W.dpeKwhM2,
      expected: target,
      sim: (c) => (c.dpeKwhM2 == null ? null : simPct(c.dpeKwhM2, target, 5, 15)),
      actual: (c) => c.dpeKwhM2,
    });
  } else if (input.dpeClass) {
    const target = input.dpeClass;
    crits.push({
      key: "dpeClass",
      weight: W.dpeClass,
      expected: target,
      sim: (c) => (c.dpeClass == null ? null : c.dpeClass === target ? 1 : 0),
      actual: (c) => c.dpeClass,
    });
  }

  // GES — numérique préféré, fallback lettre (exclusif).
  if (input.gesKgCO2M2 != null) {
    const target = input.gesKgCO2M2;
    crits.push({
      key: "gesKgCO2M2",
      weight: W.gesKgCO2M2,
      expected: target,
      sim: (c) => (c.gesKgCO2M2 == null ? null : simPct(c.gesKgCO2M2, target, 15, 30)),
      actual: (c) => c.gesKgCO2M2,
    });
  } else if (input.gesClass) {
    const target = input.gesClass;
    crits.push({
      key: "gesClass",
      weight: W.gesClass,
      expected: target,
      sim: (c) => (c.gesClass == null ? null : c.gesClass === target ? 1 : 0),
      actual: (c) => c.gesClass,
    });
  }

  if (input.yearBuilt != null) {
    const target = input.yearBuilt;
    crits.push({
      key: "yearBuilt",
      weight: W.yearBuilt,
      expected: target,
      sim: (c) => (c.yearBuilt == null ? null : simAbs(Math.abs(c.yearBuilt - target), 2, 5)),
      actual: (c) => c.yearBuilt,
    });
  }

  if (input.landSurface != null && input.propertyType === "Maison") {
    const target = input.landSurface;
    crits.push({
      key: "landSurface",
      weight: W.landSurface,
      expected: target,
      sim: (c) => (c.landSurface == null ? null : simPct(c.landSurface, target, 10, 25)),
      actual: (c) => c.landSurface,
    });
  }

  if (input.apartmentCount != null) {
    const target = input.apartmentCount;
    crits.push({
      key: "apartmentCount",
      weight: W.apartmentCount,
      expected: target,
      sim: (c) => (c.apartmentCount == null ? null : c.apartmentCount === target ? 1 : 0),
      actual: (c) => c.apartmentCount,
    });
  }

  if (input.dpeDate) {
    crits.push({
      key: "dpeDate",
      weight: W.dpeDate,
      expected: input.dpeDate,
      sim: (c) => simDate(input, c),
      actual: (c) => c.dpeDate ?? c.dpeVisitDate,
    });
  }

  if (input.propertyType) {
    crits.push({
      key: "buildingType",
      weight: W.buildingType,
      expected: input.propertyType,
      sim: (c) => buildingTypeSim(input, c),
      actual: (c) => c.buildingType,
    });
  }

  return crits;
}

// ── Sélectivité locale + scoring ───────────────────────────────────────────

/**
 * Précalcule la sélectivité de chaque critère sur le vivier `pool` :
 * rareté de la valeur de l'annonce (combien de certs la partagent aussi).
 */
export function computeSelectivities(
  input: ResolverInput,
  pool: AdemeCertificate[],
): Map<string, number> {
  const sels = new Map<string, number>();
  const n = pool.length;
  for (const crit of activeCriteria(input)) {
    let match = 0;
    for (const c of pool) {
      const s = crit.sim(c);
      if (s != null && s >= SIM_MATCH) match += 1;
    }
    sels.set(crit.key, -Math.log((1 + match) / (1 + n)));
  }
  return sels;
}

export interface ScoredCertificate {
  cert: AdemeCertificate;
  /** Score additif brut (≥ 0). */
  score: number;
  breakdown: MatchBreakdownItem[];
  /** Nb de critères concordants à forte sélectivité (pour la confiance). */
  strongConcordant: number;
}

/**
 * Score un certificat contre l'annonce, étant donné les sélectivités du vivier.
 */
export function scoreCertificate(
  input: ResolverInput,
  cert: AdemeCertificate,
  selectivities: Map<string, number>,
): ScoredCertificate {
  const breakdown: MatchBreakdownItem[] = [];
  let score = 0;
  let strongConcordant = 0;

  for (const crit of activeCriteria(input)) {
    const sim = crit.sim(cert);
    if (sim == null) continue; // non évaluable des deux côtés → ignoré
    const selectivity = selectivities.get(crit.key) ?? 0;
    const contribution = crit.weight * sim * selectivity;
    score += contribution;
    if (sim >= 0.5 && selectivity >= SELECTIVITY_STRONG) strongConcordant += 1;
    breakdown.push({
      criterion: crit.key,
      matched: sim >= SIM_MATCH,
      similarity: round3(sim),
      weight: crit.weight,
      selectivity: round3(selectivity),
      contribution: round3(contribution),
      expected: crit.expected,
      actual: crit.actual(cert),
    });
  }

  return { cert, score: round3(score), breakdown, strongConcordant };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
