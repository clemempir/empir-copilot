import type { DpeDetails, DpePoste, DpeQuality } from "../types.ts";

/**
 * Détail « second œuvre » du DPE réel (base ADEME), récupéré par numéro de DPE
 * une fois le certificat confirmé par le résolveur (`ademeCertId`).
 *
 * On remonte les 3 points que l'acheteur veut voir avant une visite :
 *  - Chauffage  : type de générateur principal (+ énergie).
 *  - Fenêtres   : qualité d'isolation des menuiseries (l'ADEME n'expose pas
 *                 « simple/double vitrage » en clair via l'API — cette échelle
 *                 insuffisante/moyenne/bonne/très bonne en est l'équivalent).
 *  - Isolation  : qualité d'isolation de l'enveloppe (globale).
 *
 * Même API Data Fair que le résolveur (`resolver/ademe.ts`), interrogée cette
 * fois par `numero_dpe_eq`. Jeu enrichi meg- d'abord, historique en secours.
 */

const ADEME_DATASET_IDS = ["meg-83tjwtg8dyz4vv7h1dqe", "dpe03existant"] as const;

const ADEME_HEADERS = {
  "user-agent": "empir-copilot/0.1 (+https://empir-copilot.fr)",
  accept: "application/json",
};

const SELECT = [
  "numero_dpe",
  "type_generateur_chauffage_principal",
  "description_generateur_chauffage_n1_installation_n1",
  "type_energie_principale_chauffage",
  "qualite_isolation_enveloppe",
  "qualite_isolation_menuiseries",
  "qualite_isolation_murs",
  "qualite_isolation_plancher_bas",
  "qualite_isolation_plancher_haut_comble_perdu",
  "qualite_isolation_plancher_haut_comble_amenage",
  "qualite_isolation_plancher_haut_toit_terrasse",
  "deperditions_murs",
  "deperditions_planchers_hauts",
  "deperditions_planchers_bas",
  "deperditions_baies_vitrees",
].join(",");

export interface FetchDpeDetailsOptions {
  fetchFn?: typeof fetch;
}

interface AdemeDetailRow {
  type_generateur_chauffage_principal?: string | null;
  description_generateur_chauffage_n1_installation_n1?: string | null;
  type_energie_principale_chauffage?: string | null;
  qualite_isolation_enveloppe?: string | null;
  qualite_isolation_menuiseries?: string | null;
  qualite_isolation_murs?: string | null;
  qualite_isolation_plancher_bas?: string | null;
  qualite_isolation_plancher_haut_comble_perdu?: string | null;
  qualite_isolation_plancher_haut_comble_amenage?: string | null;
  qualite_isolation_plancher_haut_toit_terrasse?: string | null;
  deperditions_murs?: number | string | null;
  deperditions_planchers_hauts?: number | string | null;
  deperditions_planchers_bas?: number | string | null;
  deperditions_baies_vitrees?: number | string | null;
}

/**
 * Récupère le détail DPE d'un certificat par son `numero_dpe`.
 * `null` si le certificat est introuvable ou sans aucun des 3 champs.
 */
export async function fetchDpeDetails(
  certId: string,
  opts: FetchDpeDetailsOptions = {},
): Promise<DpeDetails | null> {
  if (!certId) return null;
  const fetchFn = opts.fetchFn ?? fetch;

  let row: AdemeDetailRow | undefined;
  let lastStatus = 0;
  for (const dataset of ADEME_DATASET_IDS) {
    const url = new URL(`https://data.ademe.fr/data-fair/api/v1/datasets/${dataset}/lines`);
    url.searchParams.set("size", "1");
    url.searchParams.set("numero_dpe_eq", certId);
    url.searchParams.set("select", SELECT);
    const res = await fetchFn(url.toString(), { headers: ADEME_HEADERS });
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    const json = (await res.json()) as { results?: AdemeDetailRow[] };
    row = json.results?.[0];
    break;
  }
  if (!row) {
    if (lastStatus) throw new Error(`DPE détail ADEME: HTTP ${lastStatus}`);
    return null;
  }

  const chauffage = clean(
    row.type_generateur_chauffage_principal ??
      row.description_generateur_chauffage_n1_installation_n1 ??
      row.type_energie_principale_chauffage,
  );
  const energieChauffage = clean(row.type_energie_principale_chauffage);
  const isolation = quality(row.qualite_isolation_enveloppe);
  const fenetres = quality(row.qualite_isolation_menuiseries);
  const isolationMurs = quality(row.qualite_isolation_murs);
  // Un logement a des combles perdus OU aménagés OU un toit-terrasse : on prend
  // la variante renseignée.
  const isolationToiture =
    quality(row.qualite_isolation_plancher_haut_comble_perdu) ??
    quality(row.qualite_isolation_plancher_haut_comble_amenage) ??
    quality(row.qualite_isolation_plancher_haut_toit_terrasse);
  const isolationPlancherBas = quality(row.qualite_isolation_plancher_bas);

  const pointFaible = weakestPoste([
    { poste: "murs", q: isolationMurs, dep: num(row.deperditions_murs) },
    { poste: "toiture", q: isolationToiture, dep: num(row.deperditions_planchers_hauts) },
    { poste: "plancherBas", q: isolationPlancherBas, dep: num(row.deperditions_planchers_bas) },
    { poste: "fenetres", q: fenetres, dep: num(row.deperditions_baies_vitrees) },
  ]);

  if (
    !chauffage &&
    !isolation &&
    !fenetres &&
    !isolationMurs &&
    !isolationToiture &&
    !isolationPlancherBas
  ) {
    return null;
  }
  return {
    ...(chauffage ? { chauffage } : {}),
    ...(energieChauffage ? { energieChauffage } : {}),
    ...(isolation ? { isolation } : {}),
    ...(isolationMurs ? { isolationMurs } : {}),
    ...(isolationToiture ? { isolationToiture } : {}),
    ...(isolationPlancherBas ? { isolationPlancherBas } : {}),
    ...(fenetres ? { fenetres } : {}),
    ...(pointFaible ? { pointFaible } : {}),
  };
}

/** Rang de sévérité : 0 = pire. Seuls insuffisant/moyen comptent comme faiblesse. */
const WEAK: Record<DpeQuality, number> = { insuffisante: 0, moyenne: 1, bonne: 2, "très bonne": 3 };

/**
 * Point faible = le poste mal noté (insuffisant/moyen) où l'on perd le plus de
 * chaleur. On ne signale rien si tout est bien isolé (bonne/très bonne).
 */
function weakestPoste(
  postes: { poste: DpePoste; q: DpeQuality | undefined; dep: number | undefined }[],
): DpePoste | undefined {
  const weak = postes.filter((p) => p.q !== undefined && WEAK[p.q] <= 1);
  if (weak.length === 0) return undefined;
  // Priorité : la plus grosse déperdition ; à défaut de chiffre, la pire note.
  weak.sort((a, b) => (b.dep ?? 0) - (a.dep ?? 0) || WEAK[a.q!] - WEAK[b.q!]);
  return weak[0]!.poste;
}

function num(v: number | string | null | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t === "" || /^(non affect|non renseign|indétermin)/i.test(t) ? undefined : t;
}

/** Normalise la qualité ADEME vers l'échelle typée (accents/casse tolérés). */
function quality(v: string | null | undefined): DpeQuality | undefined {
  const t = (v ?? "").trim().toLowerCase();
  if (t.startsWith("insuffis")) return "insuffisante";
  if (t.startsWith("moyen")) return "moyenne";
  if (t.startsWith("très bonne") || t.startsWith("tres bonne")) return "très bonne";
  if (t.startsWith("bonne")) return "bonne";
  return undefined;
}
