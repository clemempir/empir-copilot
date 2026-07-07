import { stripAccentsLower } from "../extraction/mapping.ts";
import type { DvfSale, PropertyType, Comparable, MarketStats } from "../types.ts";

function isHousingType(t: string | undefined): t is PropertyType {
  return t === "Appartement" || t === "Maison";
}

const PRICE_PER_M2_MIN = 500;
// Cap = garde-fou contre les erreurs de saisie grossières uniquement : le
// filtre statistique (médiane ± 3×MAD) en aval écarte déjà les aberrants.
// 50 k€/m² couvre l'immobilier prime parisien (un cap à 20 k excluait ~17 %
// des ventes légitimes à Paris 6e et biaisait la médiane à la baisse).
const PRICE_PER_M2_MAX = 50_000;
const SURFACE_MIN = 9;
const SURFACE_MAX = 400;

export function parseDvfCsv(csv: string): DvfSale[] {
  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0]!.split(",");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`dvf: colonne manquante ${name}`);
    return i;
  };
  const idx = {
    id: col("id_mutation"),
    date: col("date_mutation"),
    nature: col("nature_mutation"),
    valeur: col("valeur_fonciere"),
    numero: col("adresse_numero"),
    voie: col("adresse_nom_voie"),
    typeLocal: col("type_local"),
    surface: col("surface_reelle_bati"),
    pieces: col("nombre_pieces_principales"),
    lon: col("longitude"),
    lat: col("latitude"),
  };

  const byMutation = new Map<string, string[][]>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const id = cells[idx.id];
    if (!id) continue;
    const group = byMutation.get(id) ?? [];
    group.push(cells);
    byMutation.set(id, group);
  }

  const sales: DvfSale[] = [];
  for (const [id, rows] of byMutation) {
    const housing = rows.filter((cells) => isHousingType(cells[idx.typeLocal]));
    // exactement 1 local d'habitation, sinon prix non ventilable (vente en bloc)
    if (housing.length !== 1) continue;
    const cells = housing[0]!;
    const typeLocal = cells[idx.typeLocal];
    // Validation explicite (et narrowing TS) : seuls Appartement/Maison passent.
    if (!isHousingType(typeLocal)) continue;
    // allowlist volontaire : seul "Vente" passe (exclut Adjudication, Échange, VEFA…)
    if (cells[idx.nature] !== "Vente") continue;

    const price = Number(cells[idx.valeur]);
    const surface = Number(cells[idx.surface]);
    const lat = Number(cells[idx.lat]);
    const lon = Number(cells[idx.lon]);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(surface) || surface < SURFACE_MIN || surface > SURFACE_MAX) continue;
    if (!cells[idx.lat] || !cells[idx.lon] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const pricePerM2 = price / surface;
    if (pricePerM2 < PRICE_PER_M2_MIN || pricePerM2 > PRICE_PER_M2_MAX) continue;

    sales.push({
      idMutation: id,
      date: cells[idx.date] ?? "",
      price,
      surface,
      rooms: Number(cells[idx.pieces]) || 0,
      pricePerM2,
      type: typeLocal,
      lat,
      lon,
      address: [cells[idx.numero], cells[idx.voie]].filter(Boolean).join(" "),
    });
  }
  return sales;
}

// ── Historique de vente du bien ────────────────────────────────────────────

export interface SaleTimeline {
  /** Points de la frise : ventes passées + prix affiché aujourd'hui. */
  nodes: { year: number; price: number }[];
  /** Résumé d'évolution, ex. « +22 % depuis 2021 · +4 %/an » (null si < 2 points). */
  summary: string | null;
}

/** Normalise une rue pour comparer (minuscules, sans accents, sans code postal/ville). */
function normStreet(s: string): string {
  return stripAccentsLower(s)
    .replace(/\b\d{5}\b.*$/, "") // retire « 40500 Saint-Sever » en fin
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ventes DVF passées DU bien : même rue+numéro (sinon proximité ≤ 20 m), et
 * surface proche (±20 %) pour rester sur le même logement dans un immeuble.
 * Triées par date croissante.
 */
export function propertySaleHistory(
  sales: DvfSale[],
  target: { address?: string; lat: number; lon: number; surface?: number },
): DvfSale[] {
  const street = target.address ? normStreet(target.address) : "";
  let matches = street ? sales.filter((s) => normStreet(s.address) === street) : [];
  if (!matches.length) {
    matches = sales.filter((s) => haversineM(target.lat, target.lon, s.lat, s.lon) <= 20);
  }
  if (target.surface != null && target.surface > 0) {
    const tol = 0.2 * target.surface;
    const bySurface = matches.filter((s) => Math.abs(s.surface - target.surface!) <= tol);
    if (bySurface.length) matches = bySurface;
  }
  return matches.sort((a, b) => a.date.localeCompare(b.date));
}

/** Frise = ventes passées + prix affiché aujourd'hui, avec % d'évolution. */
export function buildSaleTimeline(
  history: DvfSale[],
  askingPrice: number,
  now: Date = new Date(),
): SaleTimeline {
  // Une vente par année (la plus récente de l'année l'emporte — history triée asc).
  const byYear = new Map<number, number>();
  for (const s of history) {
    const y = new Date(s.date).getFullYear();
    if (Number.isFinite(y)) byYear.set(y, s.price);
  }
  const nodes = [...byYear.entries()]
    .map(([year, price]) => ({ year, price }))
    .sort((a, b) => a.year - b.year);
  const nowYear = now.getFullYear();
  if (askingPrice > 0 && !byYear.has(nowYear)) nodes.push({ year: nowYear, price: askingPrice });

  let summary: string | null = null;
  if (nodes.length >= 2) {
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const years = Math.max(1, last.year - first.year);
    const totalPct = Math.round(((last.price - first.price) / first.price) * 100);
    const annualPct = Math.round((Math.pow(last.price / first.price, 1 / years) - 1) * 1000) / 10;
    const sign = (n: number) => (n >= 0 ? "+" : "−");
    const annualStr = Math.abs(annualPct).toString().replace(".", ",");
    summary = `${sign(totalPct)}${Math.abs(totalPct)} % depuis ${first.year} · ${sign(annualPct)}${annualStr} %/an`;
  }
  return { nodes, summary };
}

const RADII_M = [500, 1000, 2000];
const MIN_SAMPLE = 10;
export const DVF_YEARS = [2023, 2024, 2025]; // fenêtre geo-dvf : 2021-2025 vérifiée 2026-06-10

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  // Fail-fast sur coordonnées invalides plutôt qu'une distance fausse silencieuse
  // (cas réel observé : coordonnées corrompues renvoyées par des APIs pour les DOM).
  if (
    !Number.isFinite(aLat) || !Number.isFinite(aLon) ||
    !Number.isFinite(bLat) || !Number.isFinite(bLon) ||
    Math.abs(aLat) > 90 || Math.abs(bLat) > 90 ||
    Math.abs(aLon) > 180 || Math.abs(bLon) > 180
  ) {
    throw new Error(
      `haversineM: coordonnées invalides (${aLat}, ${aLon}) → (${bLat}, ${bLon})`,
    );
  }
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Nearest-rank percentile: P(p) = sorted[ceil(n * p) - 1]
 * e.g. for n=8, P25 = sorted[1] (0-based), P75 = sorted[5].
 */
function percentileNearestRank(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)]!;
}

const RECENT_MONTHS = 18;

// MAD nul (tous les prix identiques, fréquent sur petits échantillons) :
// fallback à 15 % de la médiane — ordre de grandeur d'une dispersion locale
// typique, pour que le filtre médiane ± 3×MAD reste actif.
const MAD_FALLBACK_RATIO = 0.15;

// Surface « similaire » : ±30 % de la surface du bien analysé.
const SURFACE_TOLERANCE = 0.3;

function isRecent(date: string, now: Date): boolean {
  // date is "YYYY-MM-DD"
  const saleDate = new Date(date);
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RECENT_MONTHS);
  return saleDate >= cutoff;
}

export interface ComputeMarketStatsOpts {
  surface?: number;
  now?: Date;
}

export function computeMarketStats(
  sales: DvfSale[],
  center: { lat: number; lon: number },
  type: PropertyType,
  opts: ComputeMarketStatsOpts = {},
): MarketStats | null {
  const { surface, now = new Date() } = opts;
  // Fenêtre réelle des niveaux « toutes dates » : du 1er janvier de la
  // première année DVF chargée jusqu'à now (≈ 41 mois mi-2026, pas 36 en dur).
  const allDatesWindowMonths = (now.getFullYear() - DVF_YEARS[0]!) * 12 + now.getMonth();
  const typed = sales.filter((s) => s.type === type);
  for (const radiusM of RADII_M) {
    const inRadius: Comparable[] = typed
      .map((s) => ({ ...s, distanceM: Math.round(haversineM(center.lat, center.lon, s.lat, s.lon)) }))
      .filter((s) => s.distanceM <= radiusM);
    const isLastRadius = radiusM === RADII_M[RADII_M.length - 1];
    if (inRadius.length < MIN_SAMPLE && !isLastRadius) continue;
    if (inRadius.length === 0) return null;

    // filtre aberrants : médiane ± 3×MAD
    const prices = inRadius.map((s) => s.pricePerM2);
    const med = median(prices);
    const mad = median(prices.map((p) => Math.abs(p - med))) || med * MAD_FALLBACK_RATIO;
    const kept = inRadius.filter((s) => Math.abs(s.pricePerM2 - med) <= 3 * mad);
    if (kept.length === 0) return null;

    // Partition par surface similaire (±30 %) si surface fournie
    let similar: Comparable[];
    let others: Comparable[];

    if (surface !== undefined) {
      const threshold = SURFACE_TOLERANCE * surface;
      similar = kept
        .filter((s) => Math.abs(s.surface - surface) <= threshold)
        .map((s) => ({ ...s, similar: true }));
      others = kept
        .filter((s) => Math.abs(s.surface - surface) > threshold)
        .map((s) => ({ ...s, similar: false }));
    } else {
      similar = kept.map((s) => ({ ...s, similar: true }));
      others = [];
    }

    // Hiérarchie de recency (premier niveau avec ≥ MIN_SAMPLE l'emporte)
    // Niveau 1 : similaires récents
    // Niveau 2 : similaires (toutes dates)
    // Niveau 3 : récents toutes surfaces
    // Niveau 4 : tout kept
    let medianSource: Comparable[];
    let medianOnSimilar: boolean;
    let windowMonths: number;

    const similarRecent = similar.filter((s) => isRecent(s.date, now));
    const allRecent = kept.filter((s) => isRecent(s.date, now));

    if (surface !== undefined && similarRecent.length >= MIN_SAMPLE) {
      // Niveau 1
      medianSource = similarRecent;
      medianOnSimilar = true;
      windowMonths = 18;
    } else if (surface !== undefined && similar.length >= MIN_SAMPLE) {
      // Niveau 2
      medianSource = similar;
      medianOnSimilar = true;
      windowMonths = allDatesWindowMonths;
    } else if (allRecent.length >= MIN_SAMPLE) {
      // Niveau 3
      medianSource = allRecent;
      medianOnSimilar = false;
      windowMonths = 18;
    } else {
      // Niveau 4
      medianSource = kept;
      medianOnSimilar = false;
      windowMonths = allDatesWindowMonths;
    }

    const medianPrices = medianSource.map((s) => s.pricePerM2).sort((a, b) => a - b);
    const finalMedian = median(medianPrices);
    const p25 = Math.round(percentileNearestRank(medianPrices, 0.25));
    const p75 = Math.round(percentileNearestRank(medianPrices, 0.75));
    const sampleSize = medianSource.length;

    // Comparables : jusqu'à 10 similaires + 6 autres (triés par distance dans chaque groupe)
    const topSimilar = similar.sort((a, b) => a.distanceM - b.distanceM).slice(0, 10);
    const topOthers = others.sort((a, b) => a.distanceM - b.distanceM).slice(0, 6);
    const comparables = [...topSimilar, ...topOthers];

    return {
      medianPricePerM2: Math.round(finalMedian),
      p25PricePerM2: p25,
      p75PricePerM2: p75,
      sampleSize,
      radiusM,
      confidence: sampleSize >= 30 ? "high" : sampleSize >= MIN_SAMPLE ? "medium" : "low",
      comparables,
      medianOnSimilar,
      windowMonths,
    };
  }
  return null;
}

export interface FetchSalesOptions {
  years?: number[];
  fetchFn?: typeof fetch;
}

export async function fetchCommuneSales(
  citycode: string,
  opts: FetchSalesOptions = {},
): Promise<DvfSale[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const years = opts.years ?? DVF_YEARS;
  // DOM/COM : répertoire département à 3 chiffres sur geo-dvf (971-976, 98x)
  const dept = citycode.startsWith("97") || citycode.startsWith("98") ? citycode.slice(0, 3) : citycode.slice(0, 2);
  // Les années sont indépendantes : téléchargements en parallèle (l'ordre du
  // résultat reste celui de `years`).
  const perYear = await Promise.all(
    years.map(async (year) => {
      const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dept}/${citycode}.csv`;
      const res = await fetchFn(url);
      if (!res.ok) return []; // année absente → on continue
      return parseDvfCsv(await res.text());
    }),
  );
  return perYear.flat();
}
