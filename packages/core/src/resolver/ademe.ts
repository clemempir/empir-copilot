import { fixMojibake } from "../extraction/mapping.ts";

/**
 * Wrapper sur la base DPE ADEME publique (Data Fair API).
 *
 * Endpoint : https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines
 * - Aucune clé requise
 * - Filtres via `<champ>_eq=valeur` (le `qs=` Lucene exige une permission
 *   non accordée au public)
 * - `size` max 10000 par page
 * - Coordonnées dans `_geopoint` au format `"lat,lon"`
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
  /** Date d'établissement du DPE (`date_etablissement_dpe`). */
  dpeDate?: string;
  /** Date de visite du diagnostiqueur (`date_visite_diagnostiqueur`) — fallback. */
  dpeVisitDate?: string;
  /** Nombre de logements (`nombre_appartement`) — pertinent pour les immeubles. */
  apartmentCount?: number;
  /** Identifiant BAN de l'adresse (`identifiant_ban`) — clé de regroupement. */
  addressId?: string;
  /** Statut de géocodage BAN (`statut_geocodage`) — qualité du `_geopoint`. */
  geocodeStatus?: string;
  /** Score BAN (`score_ban`) ∈ [0,1] — fiabilité du point. */
  banScore?: number;
  /**
   * Surface du terrain en m². L'ADEME ne l'expose pas : ce champ est renseigné
   * a posteriori à partir de la contenance de la parcelle cadastrale (cf.
   * résolveur, passe 2 maisons).
   */
  landSurface?: number;
}

export interface FetchAdemeOptions {
  /** Code postal obligatoire — la base est trop volumineuse pour interroger autrement. */
  postalCode: string;
  /** Filtre optionnel sur le type de bâtiment (`maison` | `appartement` | `immeuble`). */
  buildingType?: "Appartement" | "Maison" | "Immeuble";
  /** Nombre maximum de candidats retournés (défaut 10000 = max d'une page ADEME). */
  limit?: number;
  /** Injection pour test. */
  fetchFn?: typeof fetch;
}

/**
 * Jeux de données ADEME interrogés, dans l'ordre : le millésime enrichi
 * (meg-…) d'abord, le dataset historique `dpe03existant` en secours si le
 * premier répond en erreur. (Comportement historique de la prod, porté ici
 * lors de la déduplication core/edge.)
 */
const ADEME_DATASET_IDS = ["meg-83tjwtg8dyz4vv7h1dqe", "dpe03existant"] as const;

const ADEME_HEADERS = {
  "user-agent": "empir-copilot/0.1 (+https://empir-copilot.fr)",
  accept: "application/json",
};

interface AdemeRow {
  numero_dpe?: string;
  adresse_ban?: string;
  code_postal_ban?: string;
  nom_commune_ban?: string;
  /** Coordonnées BAN au format `"lat,lon"`. */
  _geopoint?: string;
  surface_habitable_logement?: number;
  /** Surface portée par les DPE de type `immeuble` (le champ logement y est nul). */
  surface_habitable_immeuble?: number;
  nombre_appartement?: number;
  type_batiment?: string;
  etiquette_dpe?: string;
  conso_5_usages_par_m2_ep?: number;
  emission_ges_5_usages_par_m2?: number;
  etiquette_ges?: string;
  annee_construction?: number;
  date_etablissement_dpe?: string;
  date_visite_diagnostiqueur?: string;
  identifiant_ban?: string;
  statut_geocodage?: string;
  score_ban?: number;
}

function parseGeopoint(value: string | undefined): { lat?: number; lon?: number } {
  if (!value) return {};
  const [lat, lon] = value.split(",", 2).map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  return { lat, lon };
}

const VALID_LETTERS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

function asLetter(v: unknown): AdemeCertificate["dpeClass"] {
  if (typeof v !== "string") return undefined;
  const up = v.trim().toUpperCase();
  if (VALID_LETTERS.has(up)) return up as AdemeCertificate["dpeClass"];
  return undefined;
}

function normalize(row: AdemeRow): AdemeCertificate | null {
  const certId = row.numero_dpe;
  // Les DPE `immeuble` portent leur surface dans `surface_habitable_immeuble` :
  // on retombe dessus pour ne pas jeter ces lignes (cf. biens en copropriété).
  const surface = row.surface_habitable_logement ?? row.surface_habitable_immeuble;
  const postalCode = row.code_postal_ban;
  if (!certId || surface == null || !postalCode) return null;
  const { lat, lon } = parseGeopoint(row._geopoint);
  return {
    certId,
    // ~1 % des adresses ADEME arrivent avec un double encodage (« dâ€™Or »
    // pour « d'Or ») — réparé à l'ingestion pour tous les consommateurs.
    address: fixMojibake(row.adresse_ban ?? ""),
    postalCode,
    city: fixMojibake(row.nom_commune_ban ?? ""),
    lat,
    lon,
    surface,
    buildingType: row.type_batiment?.toLowerCase(),
    dpeClass: asLetter(row.etiquette_dpe),
    dpeKwhM2: row.conso_5_usages_par_m2_ep,
    gesKgCO2M2: row.emission_ges_5_usages_par_m2,
    gesClass: asLetter(row.etiquette_ges),
    yearBuilt: row.annee_construction || undefined,
    dpeDate: row.date_etablissement_dpe,
    dpeVisitDate: row.date_visite_diagnostiqueur,
    apartmentCount: row.nombre_appartement || undefined,
    addressId: row.identifiant_ban,
    geocodeStatus: row.statut_geocodage,
    banScore: row.score_ban,
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
  // Défaut au max d'une page ADEME : une commune dense (Mont-de-Marsan ≈ 8500
  // certs) dépasse largement 1000 ; tronquer écarte le bon certificat du gate.
  const limit = Math.min(opts.limit ?? 10_000, 10_000);

  let res: Response | null = null;
  let lastStatus = 0;
  let lastUrl = "";
  for (const dataset of ADEME_DATASET_IDS) {
    const url = new URL(`https://data.ademe.fr/data-fair/api/v1/datasets/${dataset}/lines`);
    url.searchParams.set("size", String(limit));
    url.searchParams.set("code_postal_ban_eq", opts.postalCode);
    // NB : on ne filtre plus par `type_batiment`. Un appartement en copropriété
    // peut n'avoir qu'un DPE de type `immeuble` (ou un lot), que ce filtre
    // excluait avant même le scoring. Le type est départagé par le scorer.
    url.searchParams.set(
      "select",
      [
        "numero_dpe",
        "adresse_ban",
        "code_postal_ban",
        "nom_commune_ban",
        "_geopoint",
        "surface_habitable_logement",
        "surface_habitable_immeuble",
        "nombre_appartement",
        "type_batiment",
        "etiquette_dpe",
        "conso_5_usages_par_m2_ep",
        "emission_ges_5_usages_par_m2",
        "etiquette_ges",
        "annee_construction",
        "date_etablissement_dpe",
        "date_visite_diagnostiqueur",
        "identifiant_ban",
        "statut_geocodage",
        "score_ban",
      ].join(","),
    );
    lastUrl = url.toString();
    const r = await fetchFn(lastUrl, { headers: ADEME_HEADERS });
    if (r.ok) {
      res = r;
      break;
    }
    lastStatus = r.status;
  }
  if (!res) throw new Error(`ADEME ${lastStatus} for ${lastUrl}`);
  const json = (await res.json()) as { results?: AdemeRow[]; total?: number };
  const rows = json.results ?? [];

  const out: AdemeCertificate[] = [];
  for (const row of rows) {
    const cert = normalize(row);
    if (cert) out.push(cert);
  }
  return out;
}
