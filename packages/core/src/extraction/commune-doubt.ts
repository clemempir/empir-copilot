import { stripAccentsLower } from "./mapping";

/**
 * Doute sur la commune déclarée d'une annonce.
 *
 * Mode d'échec récurrent constaté en revue (6 annonces réelles, 2026-07-03) :
 * l'agent classe l'annonce sur la grande ville (référencement) alors que la
 * description avoue que le bien est dans un village voisin — « située sur la
 * commune de VERT », « A Cauna village des landes », « à 15 mn de Mont de
 * Marsan »… Le résolveur cherche alors dans la MAUVAISE commune : au mieux il
 * s'abstient, au pire il affirme une adresse fausse (cas réel : probable 80 %
 * à Mont-de-Marsan pour un bien à Brocas).
 */
export interface CommuneDoubt {
  /** Commune nommée par le texte (si identifiée). */
  city?: string;
  /** Code postal détecté à côté du nom (signal le plus fort). */
  postalCode?: string;
  /** Extrait du texte qui a déclenché le doute. */
  evidence: string;
}

/** Normalise un nom de commune pour comparaison (accents, tirets, casse). */
function normCity(s: string): string {
  return stripAccentsLower(s).replace(/[\s'’-]+/g, " ").trim();
}

/** Nom de commune : mots capitalisés (ou tout-majuscules), tirets/apostrophes permis. */
const CITY = String.raw`([A-ZÀ-Ü][A-Za-zÀ-ÿ'’-]*(?:[\s-][A-ZÀ-Ü][A-Za-zÀ-ÿ'’-]*)*)`;

/**
 * Détecte une contradiction entre la commune déclarée et la description.
 * Renvoie `null` si rien de suspect. Conçu volontairement CONSERVATEUR :
 * mieux vaut rater un doute que d'en inventer (« proche de X » ne compte pas).
 */
export function detectCommuneDoubt(
  description: string | undefined,
  declaredCity: string | undefined,
): CommuneDoubt | null {
  if (!description || !declaredCity) return null;
  const text = description.replace(/<br\s*\/?\s*>/gi, " ").replace(/\s+/g, " ");
  const declared = normCity(declaredCity);
  const snippet = (i: number) => text.slice(Math.max(0, i - 20), i + 90).trim();

  // A. Le texte AFFIRME une commune : « sur la commune de X », « situé(e) à X (CP) »,
  //    « A X village ». Si X ≠ commune déclarée → doute nommé.
  const namedPatterns: RegExp[] = [
    new RegExp(String.raw`sur la commune d[e'’]\s*${CITY}`, "g"),
    new RegExp(String.raw`[Ss]itu[ée]{1,2}e?\s+à\s+${CITY}\s*(?:\((\d{5})\))?`, "g"),
    new RegExp(String.raw`\b[àA]\s+${CITY},?\s+village`, "g"),
  ];
  for (const re of namedPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (!name) continue;
      const cand = normCity(name);
      // Le nom capturé peut déborder (« VERT, environ ») : on compare mot à mot
      // et on coupe au premier segment qui n'est plus un nom propre plausible.
      if (!cand || cand === declared || declared.includes(cand) || cand.includes(declared)) continue;
      if (cand.split(" ").length > 4) continue; // capture trop gourmande → méfiance
      return { city: name.trim(), postalCode: m[2], evidence: snippet(m.index) };
    }
  }

  // B. Le texte situe le bien À DISTANCE de la commune déclarée : « à 15 mn de
  //    Mont de Marsan » alors que l'annonce est classée… à Mont-de-Marsan.
  //    (Une distance vers une AUTRE ville est normale et ne compte pas.)
  const declaredPattern = declared.split(" ").join(String.raw`[\s'’-]+`);
  const distRe = new RegExp(
    String.raw`\b[àa]?\s*(?:seulement\s+)?\d{1,3}\s*(?:min(?:utes)?|mn|km)\s+(?:au\s+\w+\s+)?d[eu'’]\s*(?:la ville d[e'’]\s*)?${declaredPattern}\b`,
    "i",
  );
  const dm = distRe.exec(stripAccentsLower(text));
  if (dm) {
    return { evidence: snippet(dm.index) };
  }

  return null;
}
