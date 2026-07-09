import type { CoproprieteInfo } from "../types.ts";
import { stripAccentsLower } from "../extraction/mapping.ts";

/**
 * Wrapper sur le Registre National d'Immatriculation des Copropriétés (RNIC,
 * ANAH), via l'API tabulaire de data.gouv.fr — sans clé, mis à jour quotidien.
 *
 * Ressource : registre-national-dimmatriculation-des-coproprietes
 * On cherche la copropriété du bien par trois clés, de la plus sûre à la plus
 * tolérante (cf. {@link fetchCopropriete}) :
 *  1. IDU cadastral exact sur `reference_cadastrale_1` — quand la parcelle est
 *     précise et que l'IDU cadastre = l'IDU du registre.
 *  2. Adresse (n° + rue + code postal) — LE levier fiable quand la parcelle est
 *     imprécise. Le Bon Coin ne géolocalise qu'au quartier près (~100 m) : le
 *     cadastre pointe alors une parcelle voisine, mais l'adresse résolue, elle,
 *     est exacte. Match au numéro + nom de rue près (aucune approximation).
 *  3. Repli géographique — Paris/Lyon/Marseille (le cadastre encode
 *     l'arrondissement dans l'IDU, `75102000AE0032`, quand le registre le met en
 *     préfixe, `75056102AE0032`) ET copros sur plusieurs parcelles (le registre
 *     en liste jusqu'à 3). Match sur section+numéro exacts dans une bounding box.
 *
 * On ne fait JAMAIS de « copro la plus proche » : deux copros voisines à égale
 * distance donneraient une réponse fausse. Aucun match ⇒ `null` (on n'en déduit
 * pas « maison » : le RNIC ne couvre pas 100 % du parc).
 */

const RNIC_RESOURCE = "3ea8e2c3-0038-464a-b17e-cd5c91f65ce2";
const RNIC_BASE = `https://tabular-api.data.gouv.fr/api/resources/${RNIC_RESOURCE}/data/`;

/** Bien à situer dans le registre (dérivé de `ResolvedAddress`). */
export interface CoproprieteParcel {
  /** IDU cadastral (`75103000AB0042`) — vide si non résolu. */
  id: string;
  /** Section cadastrale (`AE`). */
  section: string;
  /** Numéro de parcelle (avec ou sans zéros de tête). */
  numero: string;
  /** Adresse résolue formatée (`141 Rue Marie Curie, 40280 Saint-Pierre-du-Mont`). */
  address?: string;
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
  numero_voie_adresse?: string | null;
  code_postal_adresse?: string | null;
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

  // 1) IDU cadastral exact sur reference_cadastrale_1.
  if (parcel.id) {
    const direct = await queryRnic(
      fetchFn,
      `reference_cadastrale_1__exact=${encodeURIComponent(parcel.id)}&page_size=1`,
    );
    const info = direct[0] ? toInfo(direct[0]) : null;
    if (info) return info;
  }

  // 2) Adresse (n° + rue + code postal) — rattrape la parcelle imprécise.
  const addr = parseAddress(parcel.address);
  if (addr) {
    const row = await addressMatch(fetchFn, addr);
    const info = row ? toInfo(row) : null;
    if (info) return info;
  }

  // 3) Repli géographique : bounding box autour du bien, puis match section+numéro
  //    exacts sur les 3 emplacements de parcelle du registre.
  if (parcel.lat != null && parcel.lon != null) {
    const rows = await queryRnic(fetchFn, boundingBoxQuery(parcel.lat, parcel.lon));
    const matched = matchCopropriete(rows, parcel);
    const info = matched ? toInfo(matched) : null;
    if (info) return info;
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

/** Composantes d'adresse exploitables pour un match registre. */
interface AddressParts {
  houseNumber: string;
  streetTokens: string[];
  postalCode: string;
}

/** Types de voie ignorés dans la comparaison de rue (abréviations registre incluses). */
const STREET_TYPES = new Set([
  "rue", "r", "avenue", "av", "ave", "boulevard", "bd", "bld", "impasse", "imp",
  "allee", "allees", "all", "chemin", "che", "ch", "place", "pl", "route", "rte",
  "cours", "quai", "passage", "pas", "voie", "square", "sq", "lotissement", "lot",
  "residence", "res", "villa", "sente", "sentier", "montee", "clos", "hameau",
]);

/** Mots distinctifs de la rue (sans type de voie, sans accents, sans nombres). */
function streetTokens(street: string): string[] {
  return stripAccentsLower(street)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STREET_TYPES.has(w) && !/^\d+$/.test(w));
}

/**
 * Extrait n° + rue + code postal d'une adresse formatée
 * (`141 Rue Marie Curie, 40280 Saint-Pierre-du-Mont`). `null` si pas de numéro
 * de voie exploitable (sans numéro, un match adresse serait trop ambigu).
 */
function parseAddress(address: string | undefined): AddressParts | null {
  if (!address) return null;
  const m = address.match(/^\s*(\d+)\s*(?:bis|ter|quater)?\s+(.+?),?\s+(\d{5})\b/i);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const tokens = streetTokens(m[2]);
  if (!tokens.length) return null;
  return { houseNumber: m[1], streetTokens: tokens, postalCode: m[3] };
}

/**
 * Match par adresse : même code postal + un mot distinctif de la rue en requête,
 * puis on retient la ligne dont le numéro de voie ET tous les mots de rue
 * correspondent. Exact au numéro près — jamais « le plus proche ».
 */
async function addressMatch(fetchFn: typeof fetch, addr: AddressParts): Promise<RnicRow | null> {
  const token = [...addr.streetTokens].sort((a, b) => b.length - a.length)[0]!;
  const rows = await queryRnic(
    fetchFn,
    `code_postal_adresse__exact=${encodeURIComponent(addr.postalCode)}` +
      `&numero_voie_adresse__contains=${encodeURIComponent(token)}&page_size=100`,
  );
  return rows.find((row) => addressRowMatches(row, addr)) ?? null;
}

function addressRowMatches(row: RnicRow, addr: AddressParts): boolean {
  const raw = row.numero_voie_adresse;
  if (!raw) return false;
  const num = stripAccentsLower(raw).match(/^\s*(\d+)/);
  if (!num || num[1] !== addr.houseNumber) return false;
  const rowTokens = streetTokens(raw);
  return addr.streetTokens.every((t) => rowTokens.includes(t));
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
