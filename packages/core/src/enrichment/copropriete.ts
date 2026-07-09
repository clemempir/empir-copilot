import type { CoproprieteInfo } from "../types.ts";

/**
 * Wrapper sur le Registre National d'Immatriculation des Copropriétés (RNIC,
 * ANAH), via l'API tabulaire de data.gouv.fr — sans clé, mis à jour quotidien.
 *
 * Ressource : registre-national-dimmatriculation-des-coproprietes
 * On interroge par référence cadastrale : si la parcelle du bien y figure,
 * c'est une copropriété, et on récupère le nombre de lots.
 *
 * Deux clés d'accès (cf. {@link fetchCopropriete}) :
 *  1. IDU exact sur `reference_cadastrale_1` — marche pour la grande majorité
 *     des communes (l'IDU cadastre = l'IDU du registre).
 *  2. Repli géographique — nécessaire pour Paris/Lyon/Marseille (le cadastre
 *     encode l'arrondissement dans l'IDU, `75102000AE0032`, quand le registre
 *     le met en préfixe, `75056102AE0032` : mêmes section+numéro, chaîne
 *     différente) ET pour les copros étalées sur plusieurs parcelles (le
 *     registre en liste jusqu'à 3, la parcelle du bien pouvant être en 2ᵉ/3ᵉ).
 *
 * Aucun match ⇒ `null`. On n'en déduit PAS « maison individuelle » : le RNIC ne
 * couvre pas 100 % du parc (copros non immatriculées). Pas de match = on n'affiche rien.
 */

const RNIC_RESOURCE = "3ea8e2c3-0038-464a-b17e-cd5c91f65ce2";
const RNIC_BASE = `https://tabular-api.data.gouv.fr/api/resources/${RNIC_RESOURCE}/data/`;

/** Parcelle du bien (dérivée de `ResolvedAddress`). */
export interface CoproprieteParcel {
  /** IDU cadastral (`75103000AB0042`). */
  id: string;
  /** Section cadastrale (`AE`). */
  section: string;
  /** Numéro de parcelle (avec ou sans zéros de tête). */
  numero: string;
  /** Point du bien — requis pour le repli géographique. */
  lat?: number;
  lon?: number;
}

export interface FetchCoproprieteOptions {
  fetchFn?: typeof fetch;
}

/** Ligne brute du registre (champs sérialisés en chaînes par l'API tabulaire). */
interface RnicRow {
  nombre_total_lots?: string | number | null;
  nombre_lots_habitation?: string | number | null;
  nom_usage_copropriete?: string | null;
  section_parcelle_1?: string | null;
  numero_parcelle_1?: string | null;
  section_parcelle_2?: string | null;
  numero_parcelle_2?: string | null;
  section_parcelle_3?: string | null;
  numero_parcelle_3?: string | null;
}

/**
 * Cherche la copropriété correspondant à une parcelle dans le RNIC.
 * Retourne `null` si la parcelle n'y figure pas (bien probablement non en copro).
 */
export async function fetchCopropriete(
  parcel: CoproprieteParcel,
  opts: FetchCoproprieteOptions = {},
): Promise<CoproprieteInfo | null> {
  const fetchFn = opts.fetchFn ?? fetch;

  // 1) Clé primaire : IDU exact sur reference_cadastrale_1.
  const direct = await queryRnic(
    fetchFn,
    `reference_cadastrale_1__exact=${encodeURIComponent(parcel.id)}&page_size=1`,
  );
  if (direct[0]) return toInfo(direct[0]);

  // 2) Repli géographique : bounding box autour du bien, puis match section+numéro
  //    sur les 3 emplacements de parcelle du registre.
  if (parcel.lat != null && parcel.lon != null) {
    const rows = await queryRnic(fetchFn, boundingBoxQuery(parcel.lat, parcel.lon));
    const matched = rows.find((row) => rowMatchesParcel(row, parcel));
    if (matched) return toInfo(matched);
  }

  return null;
}

/**
 * Sélectionne, parmi des lignes du registre, celle dont l'une des parcelles
 * (jusqu'à 3) a la même section + le même numéro que la parcelle du bien.
 * Isolée et pure : c'est le cœur fragile (normalisation section/numéro).
 */
export function matchCopropriete(rows: RnicRow[], parcel: CoproprieteParcel): RnicRow | null {
  return rows.find((row) => rowMatchesParcel(row, parcel)) ?? null;
}

async function queryRnic(fetchFn: typeof fetch, query: string): Promise<RnicRow[]> {
  const res = await fetchFn(`${RNIC_BASE}?${query}`);
  if (!res.ok) throw new Error(`copropriété RNIC: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: RnicRow[] };
  return json.data ?? [];
}

/** Bounding box ~180 m autour du point (delta longitude corrigé de la latitude). */
function boundingBoxQuery(lat: number, lon: number): string {
  const dLat = 0.0016;
  const dLon = 0.0016 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return [
    `latitude__greater=${(lat - dLat).toFixed(6)}`,
    `latitude__less=${(lat + dLat).toFixed(6)}`,
    `longitude__greater=${(lon - dLon).toFixed(6)}`,
    `longitude__less=${(lon + dLon).toFixed(6)}`,
    "page_size=100",
  ].join("&");
}

function rowMatchesParcel(row: RnicRow, parcel: CoproprieteParcel): boolean {
  const sect = normSection(parcel.section);
  const num = normNumero(parcel.numero);
  if (!sect || !num) return false;
  for (let i = 1; i <= 3; i++) {
    const rs = normSection(row[`section_parcelle_${i}` as keyof RnicRow] as string | null);
    const rn = normNumero(row[`numero_parcelle_${i}` as keyof RnicRow] as string | null);
    if (rs && rn && rs === sect && rn === num) return true;
  }
  return false;
}

/** Section en majuscules, zéros de tête retirés (`0A` ⇒ `A`, `AE` ⇒ `AE`). */
function normSection(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/^0+(?=[0-9A-Z])/, "");
}

/** Numéro sans zéros de tête (`0032` ⇒ `32`, `96` ⇒ `96`). */
function normNumero(n: string | null | undefined): string {
  return (n ?? "").trim().replace(/^0+/, "");
}

function toInfo(row: RnicRow): CoproprieteInfo | null {
  const lotsTotal = toInt(row.nombre_total_lots);
  if (lotsTotal == null || lotsTotal <= 0) return null;
  const lotsHabitation = toInt(row.nombre_lots_habitation);
  const nom = cleanNom(row.nom_usage_copropriete);
  return {
    isCopropriete: true,
    lotsTotal,
    ...(lotsHabitation != null ? { lotsHabitation } : {}),
    ...(nom ? { nom } : {}),
  };
}

function toInt(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Retire le préfixe technique du registre (`0149 - SDC …` ⇒ `SDC …`). */
function cleanNom(nom: string | null | undefined): string | undefined {
  const t = (nom ?? "").trim().replace(/^\d+\s*-\s*/, "").trim();
  return t === "" ? undefined : t;
}
