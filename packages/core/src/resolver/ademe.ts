/**
 * Wrapper sur la base DPE ADEME publique (Data Fair API).
 *
 * Endpoint : https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines
 * - Aucune clé requise
 * - Filtres via `qs` (Lucene syntax) : ex. `code_postal_ban:"75003"`
 * - `size` max 10000 par page
 *
 * Le dataset v2 (depuis 2021) expose les valeurs numériques utiles à la
 * résolution d'adresse : consommation en kWh/m²/an et émissions en kg CO₂/m²/an.
 */

export interface AdemeCertificate {
  /** Identifiant unique du certificat (`numero_dpe`). */
  certId: string;
  /** Adresse au format BAN telle que retournée par l'ADEME. */
  address: string;
  /** Code postal (BAN). */
  postalCode: string;
  /** Nom de la commune (BAN). */
  city: string;
  /** Coordonnées issues du géocodage BAN inclus dans le certificat. */
  lat?: number;
  lon?: number;
  /** Surface habitable en m². */
  surface: number;
  /** Type de bâtiment (`maison`, `appartement`, `immeuble`). */
  buildingType?: string;
  /** Lettre A-G énergie primaire. */
  dpeClass?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  /** kWh/m²/an. */
  dpeKwhM2?: number;
  /** kg CO₂/m²/an. */
  gesKgCO2M2?: number;
  /** Lettre A-G GES. */
  gesClass?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  /** Année de construction (peut être nulle). */
  yearBuilt?: number;
  /** Date du DPE (`date_etablissement_dpe`). */
  dpeDate?: string;
}

export interface FetchAdemeOptions {
  /** Code postal obligatoire — la base est trop volumineuse pour interroger autrement. */
  postalCode: string;
  /** Filtre optionnel sur le type de bâtiment (`maison` | `appartement`). */
  buildingType?: "Appartement" | "Maison";
  /** Nombre maximum de candidats retournés (défaut 1000). */
  limit?: number;
  /** Injection pour test. */
  fetchFn?: typeof fetch;
}

const ADEME_BASE =
  "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines";

interface AdemeRow {
  N_DPE?: string;
  numero_dpe?: string;
  adresse_ban?: string;
  code_postal_ban?: string;
  nom__commune_ban?: string;
  nom_commune_ban?: string;
  ban_x?: number;
  ban_y?: number;
  latitude?: number;
  longitude?: number;
  surface_habitable_logement?: number;
  type_batiment?: string;
  etiquette_dpe?: string;
  conso_5_usages_par_m2_ep?: number;
  emission_ges_5_usages_par_m2?: number;
  etiquette_ges?: string;
  annee_construction?: number;
  date_etablissement_dpe?: string;
}

const VALID_LETTERS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

function asLetter(v: unknown): AdemeCertificate["dpeClass"] {
  if (typeof v !== "string") return undefined;
  const up = v.trim().toUpperCase();
  if (VALID_LETTERS.has(up)) return up as AdemeCertificate["dpeClass"];
  return undefined;
}

function normalize(row: AdemeRow): AdemeCertificate | null {
  const certId = row.numero_dpe ?? row.N_DPE;
  const surface = row.surface_habitable_logement;
  const postalCode = row.code_postal_ban;
  if (!certId || surface == null || !postalCode) return null;
  return {
    certId,
    address: row.adresse_ban ?? "",
    postalCode,
    city: row.nom_commune_ban ?? row.nom__commune_ban ?? "",
    lat: row.latitude ?? row.ban_y,
    lon: row.longitude ?? row.ban_x,
    surface,
    buildingType: row.type_batiment?.toLowerCase(),
    dpeClass: asLetter(row.etiquette_dpe),
    dpeKwhM2: row.conso_5_usages_par_m2_ep,
    gesKgCO2M2: row.emission_ges_5_usages_par_m2,
    gesClass: asLetter(row.etiquette_ges),
    yearBuilt: row.annee_construction || undefined,
    dpeDate: row.date_etablissement_dpe,
  };
}

/**
 * Requête la base ADEME et retourne tous les certificats correspondant au
 * code postal (et optionnellement au type de bâtiment).
 *
 * Le filtrage fin (surface, DPE numérique…) est délégué au scorer pour
 * conserver des candidats proches mais non-parfaitement matchés.
 */
export async function fetchAdemeCertificates(
  opts: FetchAdemeOptions,
): Promise<AdemeCertificate[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = Math.min(opts.limit ?? 1000, 10_000);

  const qs: string[] = [`code_postal_ban:"${opts.postalCode}"`];
  if (opts.buildingType) {
    qs.push(`type_batiment:"${opts.buildingType.toLowerCase()}"`);
  }

  const url = new URL(ADEME_BASE);
  url.searchParams.set("size", String(limit));
  url.searchParams.set("qs", qs.join(" AND "));
  url.searchParams.set(
    "select",
    [
      "numero_dpe",
      "adresse_ban",
      "code_postal_ban",
      "nom_commune_ban",
      "ban_x",
      "ban_y",
      "surface_habitable_logement",
      "type_batiment",
      "etiquette_dpe",
      "conso_5_usages_par_m2_ep",
      "emission_ges_5_usages_par_m2",
      "etiquette_ges",
      "annee_construction",
      "date_etablissement_dpe",
    ].join(","),
  );

  const res = await fetchFn(url.toString());
  if (!res.ok) throw new Error(`ADEME DPE: HTTP ${res.status}`);
  const json = (await res.json()) as { results?: AdemeRow[]; total?: number };
  const rows = json.results ?? [];

  const out: AdemeCertificate[] = [];
  for (const row of rows) {
    const cert = normalize(row);
    if (cert) out.push(cert);
  }
  return out;
}
