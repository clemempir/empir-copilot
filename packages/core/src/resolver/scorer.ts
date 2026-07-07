import type { AdemeCertificate } from "./ademe.ts";
import type { MatchBreakdownItem, MatchFactor, ResolverInput } from "./types.ts";

/**
 * SCORING — « croisements multiplicatifs × sélectivité locale » (façon parcellai.re,
 * généralisé). Le score d'une adresse n'est plus une somme de poids fixes mais :
 *
 *     base(c) = Σ_combos  combo(c) · sel(combo)
 *
 *   • combo(c)   = PRODUIT des similarités de ses membres ∈ [0,1]. Un combo ne
 *                  « s'allume » que si TOUS ses facteurs concordent : un attribut
 *                  isolé ne rapporte donc rien, il ne compte que multiplié.
 *   • sel(combo) = rareté LOCALE du combo dans le vivier P (les certs de la
 *                  commune passant les filtres) :
 *                      sel = -ln( (1 + #{c'∈P : tous les membres concordent}) / (1+|P|) )
 *                  ≈ 0 si tout le monde partage le combo ; grand s'il est rare.
 *
 * ÉPINE (socle, comme leur moteur) = produit des sim des attributs FORTS présents
 * parmi {date, conso(chiffrée), type}. Si aucun des trois n'est fourni, l'épine
 * retombe sur surface × type. Tous les autres combos sont l'épine × un attribut
 * supplémentaire (ges, surface, année, lots), plus un canal terrain autonome.
 *
 * Le DPE/GES en LETTRE n'est qu'un repli (×0.4, fourchette large) quand la valeur
 * chiffrée manque ; conso OU classe, jamais les deux (idem GES).
 *
 * EXPLICABILITÉ : chaque combo est tracé dans `matchBreakdown` avec ses facteurs,
 * sa sélectivité et sa contribution → Σ contributions = base (reproductible à la
 * main, cf. le 31,5 % de parcellai.re).
 *
 * ⚠️ Réplique manuelle dans `supabase/functions/resolve-address/index.ts` :
 *    toute modification doit être propagée à l'identique.
 */

// ── Constantes paramétrables (calibration future) ──────────────────────────

/** Tolérances [serrée, max] en pourcentage pour les similarités numériques. */
export const TOL = {
  surfacePct: [5, 15],
  consoPct: [3, 12],
  gesPct: [15, 35],
  terrainPct: [10, 30],
  yearAbs: [3, 10],
  /** Date : 1 si écart ≤ 3 j, →0 à ±45 j. */
  dateDays: [3, 45],
} as const;

/** Poids du repli « lettre » : une classe DPE/GES est une fourchette large. */
const LETTER_FALLBACK = 0.4;
/** Seuil de similarité « concordant » (tolérance serrée). */
const SIM_MATCH = 0.999;
/** Un membre « compte » pour la sélectivité dès qu'il est dans la tolérance. */
const SIM_PRESENT = 1e-9;
/** Combo « fort » : valeur élevée ET localement rare (pour la confiance). */
export const SELECTIVITY_STRONG = 1.0;
const MS_PER_DAY = 86_400_000;

// ── Similarités graduées sim_k ∈ [0,1] ─────────────────────────────────────

/** Similarité numérique avec tolérances en pourcentage de la cible. */
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

/** Similarité « date DPE » : meilleur écart à date_etablissement OU date_visite. */
function simDate(input: ResolverInput, cert: AdemeCertificate): number | null {
  const target = parseDay(input.dpeDate);
  if (target == null) return null;
  const cands = [parseDay(cert.dpeDate), parseDay(cert.dpeVisitDate)].filter(
    (v): v is number => v != null,
  );
  if (!cands.length) return null;
  const bestDays = Math.min(...cands.map((t) => Math.abs(target - t))) / MS_PER_DAY;
  return simAbs(bestDays, TOL.dateDays[0], TOL.dateDays[1]);
}

/** Type : 1 si compatible (appartement ⊇ immeuble), 0 sinon, null si inconnu. */
function simType(input: ResolverInput, cert: AdemeCertificate): number | null {
  if (!input.propertyType || !cert.buildingType) return null;
  const want = input.propertyType.toLowerCase();
  if (want === "maison") return cert.buildingType === "maison" ? 1 : 0;
  // appartement ≈ immeuble (un appartement appartient à un immeuble)
  return cert.buildingType === "appartement" || cert.buildingType === "immeuble" ? 1 : 0;
}

// ── Critères : une similarité continue + valeurs pour l'explicabilité ───────

interface Crit {
  key: string;
  /** Similarité du certificat, ou null si le critère n'est pas évaluable. */
  sim(cert: AdemeCertificate): number | null;
  /** Valeur attendue (annonce) — pour le breakdown. */
  expected?: string | number;
  /** Valeur trouvée (certificat) — pour le breakdown. */
  actual(cert: AdemeCertificate): string | number | undefined;
}

/** Construit les critères évaluables selon les attributs présents dans l'annonce. */
function criteria(input: ResolverInput): Record<string, Crit | undefined> {
  const c: Record<string, Crit | undefined> = {};

  if (input.surface != null) {
    const t = input.surface;
    c.surface = {
      key: "surface",
      expected: t,
      sim: (x) => simPct(x.surface, t, TOL.surfacePct[0], TOL.surfacePct[1]),
      actual: (x) => x.surface,
    };
  }

  // Conso — chiffrée prioritaire, repli classe (×0.4), exclusif.
  if (input.dpeKwhM2 != null) {
    const t = input.dpeKwhM2;
    c.conso = {
      key: "dpeKwhM2",
      expected: t,
      sim: (x) => (x.dpeKwhM2 == null ? null : simPct(x.dpeKwhM2, t, TOL.consoPct[0], TOL.consoPct[1])),
      actual: (x) => x.dpeKwhM2,
    };
  } else if (input.dpeClass) {
    const t = input.dpeClass;
    c.conso = {
      key: "dpeClass",
      expected: t,
      sim: (x) => (x.dpeClass == null ? null : (x.dpeClass === t ? 1 : 0) * LETTER_FALLBACK),
      actual: (x) => x.dpeClass,
    };
  }

  // GES — chiffré prioritaire, repli classe (×0.4), exclusif.
  if (input.gesKgCO2M2 != null) {
    const t = input.gesKgCO2M2;
    c.ges = {
      key: "gesKgCO2M2",
      expected: t,
      sim: (x) => (x.gesKgCO2M2 == null ? null : simPct(x.gesKgCO2M2, t, TOL.gesPct[0], TOL.gesPct[1])),
      actual: (x) => x.gesKgCO2M2,
    };
  } else if (input.gesClass) {
    const t = input.gesClass;
    c.ges = {
      key: "gesClass",
      expected: t,
      sim: (x) => (x.gesClass == null ? null : (x.gesClass === t ? 1 : 0) * LETTER_FALLBACK),
      actual: (x) => x.gesClass,
    };
  }

  if (input.yearBuilt != null) {
    const t = input.yearBuilt;
    c.year = {
      key: "yearBuilt",
      expected: t,
      sim: (x) => (x.yearBuilt == null ? null : simAbs(Math.abs(x.yearBuilt - t), TOL.yearAbs[0], TOL.yearAbs[1])),
      actual: (x) => x.yearBuilt,
    };
  }

  if (input.landSurface != null && input.propertyType === "Maison") {
    const t = input.landSurface;
    c.terrain = {
      key: "landSurface",
      expected: t,
      sim: (x) => (x.landSurface == null ? null : simPct(x.landSurface, t, TOL.terrainPct[0], TOL.terrainPct[1])),
      actual: (x) => x.landSurface,
    };
  }

  if (input.apartmentCount != null) {
    const t = input.apartmentCount;
    c.apts = {
      key: "apartmentCount",
      expected: t,
      sim: (x) => (x.apartmentCount == null ? null : x.apartmentCount === t ? 1 : 0),
      actual: (x) => x.apartmentCount,
    };
  }

  if (input.dpeDate) {
    c.date = {
      key: "dpeDate",
      expected: input.dpeDate,
      sim: (x) => simDate(input, x),
      actual: (x) => x.dpeDate ?? x.dpeVisitDate,
    };
  }

  if (input.propertyType) {
    c.type = {
      key: "buildingType",
      expected: input.propertyType,
      sim: (x) => simType(input, x),
      actual: (x) => x.buildingType,
    };
  }

  return c;
}

// ── Combos (croisements) ───────────────────────────────────────────────────

interface ComboDef {
  /** Libellé affiché dans le breakdown. */
  label: string;
  /** Critères membres : tous doivent concorder pour que le combo s'allume. */
  members: Crit[];
}

/**
 * Définit les croisements à partir des critères présents :
 *   - épine = produit des attributs forts {date, conso, type} (repli surface×type) ;
 *   - épine × ges / surface / année / lots ;
 *   - terrain autonome (cadastre, maisons).
 * L'ordre est déterministe → sélectivités et breakdown alignés.
 */
function comboDefs(input: ResolverInput): ComboDef[] {
  const c = criteria(input);

  const spineMembers: Crit[] = [];
  if (c.date) spineMembers.push(c.date);
  if (c.conso) spineMembers.push(c.conso);
  if (c.type) spineMembers.push(c.type);
  // Repli : sans aucun attribut fort, l'épine s'appuie sur surface × type.
  const spineIsFallback = spineMembers.length === 0;
  if (spineIsFallback) {
    if (c.surface) spineMembers.push(c.surface);
    if (c.type) spineMembers.push(c.type);
  }

  const combos: ComboDef[] = [];
  if (spineMembers.length) combos.push({ label: "épine", members: spineMembers });

  // L'épine sert de socle multiplicatif à chaque attribut supplémentaire.
  const spine = spineMembers;
  if (c.ges) combos.push({ label: "épine×ges", members: [...spine, c.ges] });
  // surface n'est croisée que si elle n'est pas déjà dans l'épine (repli).
  if (c.surface && !spineIsFallback) combos.push({ label: "épine×surface", members: [...spine, c.surface] });
  if (c.year) combos.push({ label: "épine×année", members: [...spine, c.year] });
  if (c.apts) combos.push({ label: "épine×lots", members: [...spine, c.apts] });
  // Terrain : canal autonome (la contenance cadastrale est très discriminante).
  if (c.terrain) combos.push({ label: "terrain", members: [c.terrain] });

  return combos;
}

/** Valeur d'un combo pour un cert = produit des sim ; 0 si un membre manque. */
function comboValue(combo: ComboDef, cert: AdemeCertificate): number {
  let v = 1;
  for (const m of combo.members) {
    const s = m.sim(cert);
    if (s == null || s <= 0) return 0;
    v *= s;
  }
  return v;
}

/** Le combo concorde-t-il (tous ses membres dans la tolérance) pour un cert ? */
function comboMatches(combo: ComboDef, cert: AdemeCertificate): boolean {
  for (const m of combo.members) {
    const s = m.sim(cert);
    if (s == null || s < SIM_PRESENT) return false;
  }
  return true;
}

// ── Sélectivité locale + scoring ───────────────────────────────────────────

/**
 * Précalcule la sélectivité de chaque combo sur le vivier `pool` : rareté du
 * combo (combien de certs concordent sur TOUS ses membres).
 *   sel = -ln( (1 + #concordants) / (1 + |P|) )
 */
export function computeSelectivities(
  input: ResolverInput,
  pool: AdemeCertificate[],
): Map<string, number> {
  const sels = new Map<string, number>();
  const n = pool.length;
  for (const combo of comboDefs(input)) {
    let match = 0;
    for (const c of pool) if (comboMatches(combo, c)) match += 1;
    sels.set(combo.label, -Math.log((1 + match) / (1 + n)));
  }
  return sels;
}

export interface ScoredCertificate {
  cert: AdemeCertificate;
  /** Score attributaire = Σ_combos combo × sélectivité (≥ 0). */
  score: number;
  breakdown: MatchBreakdownItem[];
  /** Nb de combos « forts » (valeur ≥ 0.5 ET sélectivité forte) — pour la confiance. */
  strongConcordant: number;
}

/**
 * Score un certificat : base = Σ combo(c)·sel(combo). Le breakdown trace chaque
 * combo (facteurs, sélectivité, contribution) → la somme des contributions
 * reproduit `score`.
 */
export function scoreCertificate(
  input: ResolverInput,
  cert: AdemeCertificate,
  selectivities: Map<string, number>,
): ScoredCertificate {
  const breakdown: MatchBreakdownItem[] = [];
  let score = 0;
  let strongConcordant = 0;

  for (const combo of comboDefs(input)) {
    const value = comboValue(combo, cert);
    const selectivity = selectivities.get(combo.label) ?? 0;
    const contribution = value * selectivity;
    score += contribution;
    // « Combo fort » = un combo qui s'allume (value > 0) ET localement rare.
    // C'est la sélectivité qui qualifie le signal, pas la magnitude (un combo à
    // repli-lettre plafonne à 0.4 mais reste discriminant s'il est rare).
    if (value > 0 && selectivity >= SELECTIVITY_STRONG) strongConcordant += 1;

    const factors: MatchFactor[] = combo.members.map((m) => ({
      criterion: m.key,
      similarity: round3(m.sim(cert) ?? 0),
      expected: m.expected,
      actual: m.actual(cert),
    }));
    // Combos mono-distinctifs : remonter attendu/trouvé du facteur distinctif.
    const distinctive = combo.members[combo.members.length - 1];
    breakdown.push({
      criterion: combo.label,
      matched: value >= SIM_MATCH,
      similarity: round3(value),
      selectivity: round3(selectivity),
      contribution: round3(contribution),
      factors,
      expected: distinctive?.expected,
      actual: distinctive?.actual(cert),
    });
  }

  return { cert, score: round3(score), breakdown, strongConcordant };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
