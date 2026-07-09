import { fixMojibake } from "../extraction/mapping.ts";

/**
 * Classification des zones patrimoniales soumises à l'Architecte des Bâtiments
 * de France (ABF), à partir des servitudes d'utilité publique surfaciques du
 * module GPU de l'API Carto IGN (endpoint `assiette-sup-s`).
 *
 * Le fetch est fait côté serveur (fonction edge `analyze`, comme le PLU) : cette
 * fonction reçoit le FeatureCollection brut et le classe. Pure (aucun DOM),
 * compatible service worker MV3.
 *
 * Deux catégories de servitude déclenchent l'avis ABF :
 *   - AC1 : abords de monument historique (périmètre de protection / PDA)
 *   - AC4 : Site Patrimonial Remarquable (ex-secteur sauvegardé, ZPPAUP, AVAP)
 */

export interface PatrimoineCategorie {
  code: "AC1" | "AC4";
  /** Libellé court du type de protection. */
  label: string;
  /** Nom littéral de la servitude si présent (ex. « Site patrimonial remarquable de Sarlat »). */
  nom?: string;
  /** Explication des implications concrètes pour le propriétaire. */
  implication: string;
}

export interface ZonePatrimoine {
  concerne: boolean;
  categories: PatrimoineCategorie[];
}

const ABF: Record<"AC1" | "AC4", { label: string; implication: string }> = {
  AC1: {
    label: "Abords de monument historique",
    implication:
      "Le bien est dans le périmètre de protection d'un monument historique. " +
      "Tous les travaux modifiant l'aspect extérieur (façade, toiture, menuiseries, " +
      "clôtures, ravalement) sont soumis à l'accord de l'Architecte des Bâtiments de France.",
  },
  AC4: {
    label: "Site patrimonial remarquable",
    implication:
      "Le bien est en Site Patrimonial Remarquable (ex-secteur sauvegardé, ZPPAUP ou AVAP). " +
      "Les travaux extérieurs sont soumis à l'avis de l'Architecte des Bâtiments de France " +
      "et doivent respecter le règlement du site (PSMV ou PVAP).",
  },
};

interface Feature {
  properties?: Record<string, unknown>;
}

/**
 * @param raw FeatureCollection brut renvoyé par `assiette-sup-s` (ou null si le
 *   service IGN était injoignable côté serveur).
 * @returns `null` si l'information est indisponible (raw absent / invalide),
 *   sinon `{ concerne, categories }`.
 */
export function getZonePatrimoine(raw: unknown): ZonePatrimoine | null {
  const features = (raw as { features?: unknown })?.features;
  // Pas de FeatureCollection exploitable → information indisponible (service down).
  if (!Array.isArray(features)) {
    if (raw != null) console.warn("[zone-patrimoine] réponse GPU inattendue :", raw);
    return null;
  }

  const byCode = new Map<"AC1" | "AC4", PatrimoineCategorie>();
  for (const f of features as Feature[]) {
    const p = f.properties ?? {};
    // Le nom du champ catégorie varie selon les jeux ; valeurs parfois en
    // minuscules → on normalise en majuscules.
    const rawCode = p.suptype ?? p.categorie ?? p.type_sup;
    const code = typeof rawCode === "string" ? rawCode.toUpperCase() : "";
    if (code !== "AC1" && code !== "AC4") continue;
    if (byCode.has(code)) continue; // dédup par catégorie

    const rawNom = p.nomsuplitt ?? p.libelle ?? p.nom;
    const nom = typeof rawNom === "string" && rawNom.trim() ? fixMojibake(rawNom.trim()) : undefined;
    byCode.set(code, { code, label: ABF[code].label, nom, implication: ABF[code].implication });
  }

  const categories = [...byCode.values()];
  return { concerne: categories.length > 0, categories };
}
