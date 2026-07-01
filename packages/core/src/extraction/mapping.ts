import type { ListingGeo, PropertyType } from "../types";

/** Coerce an unknown value to a finite positive number (parses strings like "289 000 €"). */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,]/g, "").replace(/\s/g, "").replace(",", ".");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function toStr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

/** Normalise a DPE/GES letter; returns undefined unless it's a single A-G letter. */
export function toLetter(value: unknown): string | undefined {
  const s = toStr(value);
  if (!s) return undefined;
  const up = s.toUpperCase();
  return /^[A-G]$/.test(up) ? up : undefined;
}

/** Map a site-specific property-type token to the normalised PropertyType. */
export function toPropertyType(value: unknown): PropertyType | undefined {
  const s = toStr(value)?.toLowerCase();
  if (!s) return undefined;
  if (/(appartement|flat|apartment)/.test(s)) return "Appartement";
  if (/(maison|house|villa)/.test(s)) return "Maison";
  if (/(immeuble|building)/.test(s)) return "Immeuble";
  return undefined;
}

export function buildRawAddress(
  city: string | undefined,
  postalCode: string | undefined,
  district: string | undefined,
): string {
  return [city, postalCode, district].filter(Boolean).join(" ");
}

/**
 * Extrait une consommation DPE en kWh/m²/an depuis un texte libre
 * (« 165 kWh/m²/an », « 165 kWhEP/m².an »…). Best-effort, `undefined` si absent.
 */
export function extractKwhM2(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/(\d[\d\s.,]*)\s*kwh/i);
  return m ? toNumber(m[1]) : undefined;
}

/**
 * Extrait une émission GES en kg CO₂/m²/an depuis un texte libre
 * (« 28 kg CO2/m²/an », « 28 kgCO₂eq »…). Best-effort, `undefined` si absent.
 */
export function extractGesKgM2(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/(\d[\d\s.,]*)\s*kg(?:[\s./]*(?:eq\.?\s*)?(?:co2|co₂))/i);
  return m ? toNumber(m[1]) : undefined;
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
};

function stripAccentsLower(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const pad2 = (s: string) => s.padStart(2, "0");

/** Token de date : numérique (`12/03/2024`), ISO (`2024-03-12`), ou en toutes lettres FR (`5 décembre 2024`). */
const DATE_TOKEN = String.raw`(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[^\d\s]{3,}\s+\d{4})`;

/**
 * Normalise une date FR (`dd/mm/yyyy`, `dd-mm-yyyy`), ISO (`yyyy-mm-dd`), ou en
 * toutes lettres (`5 décembre 2024`) en `yyyy-mm-dd`. `undefined` si non reconnue.
 */
export function parseFrenchDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const num = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (num) {
    const [, d, m, y] = num;
    if (d && m && y) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const long = text.match(/(\d{1,2})\s+([^\d\s]{3,})\s+(\d{4})/);
  if (long) {
    const [, d, name, y] = long;
    if (d && name && y) {
      const month = FRENCH_MONTHS[stripAccentsLower(name)];
      if (month) return `${y}-${month}-${pad2(d)}`;
    }
  }
  return undefined;
}

/**
 * Cherche une date d'établissement de DPE dans un texte libre
 * (« DPE réalisé le 12/03/2024 », « Date de réalisation du DPE : 5 décembre
 * 2024 », « diagnostic effectué le … »). Renvoie l'ISO.
 */
export function extractDpeDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const near =
    text.match(new RegExp(`dpe[^.]{0,40}?${DATE_TOKEN}`, "i")) ??
    text.match(new RegExp(`(?:réalis|établi|etabli|effectué|valable)[^.]{0,25}?${DATE_TOKEN}`, "i"));
  return near ? parseFrenchDate(near[1]) : undefined;
}

/** Décode jusqu'à 2 fois un composant d'URL (les payloads Mapbox sont souvent doublement encodés). */
function safeDecodeURI(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** Centre + rayon (m) d'un anneau de coordonnées GeoJSON `[lon,lat]`. */
function polygonCentroidRadius(coords: unknown): ListingGeo | undefined {
  const verts: [number, number][] = [];
  const walk = (a: unknown): void => {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === "number" && typeof a[1] === "number") verts.push([a[0], a[1]]);
    else for (const x of a) walk(x);
  };
  walk(coords);
  if (!verts.length) return undefined;
  const lon = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const lat = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  let radiusM = 0;
  for (const v of verts) {
    const dLat = (v[1] - lat) * 111_200;
    const dLon = (v[0] - lon) * Math.cos((lat * Math.PI) / 180) * 111_320;
    radiusM = Math.max(radiusM, Math.sqrt(dLat * dLat + dLon * dLon));
  }
  return { lat, lon, radiusM: Math.round(radiusM) };
}

/**
 * Extrait la localisation d'une page SeLoger depuis l'overlay Mapbox statique
 * (`…/static/geojson(<GeoJSON>)…`). `Point` ⇒ marqueur précis ; `Polygon`/
 * `MultiPolygon` ⇒ centre + rayon (un petit polygone = précis, le contour de la
 * commune = disque large que le résolveur traite comme imprécis).
 */
export function extractSelogerGeo(raw: string | undefined): ListingGeo | undefined {
  if (!raw) return undefined;
  const m = raw.match(/geojson\(([^)]+)\)/);
  const enc = m?.[1];
  if (!enc) return undefined;
  let gj: { geometry?: { type?: string; coordinates?: unknown } } | null = null;
  try {
    gj = JSON.parse(safeDecodeURI(enc));
  } catch {
    return undefined;
  }
  const geom = gj?.geometry;
  if (!geom) return undefined;
  if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
    const lon = geom.coordinates[0];
    const lat = geom.coordinates[1];
    // Marqueur GPS publié (adresse exacte) ⇒ gate serré côté résolveur.
    if (typeof lat === "number" && typeof lon === "number") return { lat, lon, precise: true };
    return undefined;
  }
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return polygonCentroidRadius(geom.coordinates);
  }
  return undefined;
}
