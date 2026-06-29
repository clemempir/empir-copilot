import type { PropertyType } from "../types";

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

/**
 * Normalise une date FR (`dd/mm/yyyy`, `dd-mm-yyyy`) ou ISO (`yyyy-mm-dd`) en
 * `yyyy-mm-dd`. `undefined` si non reconnue.
 */
export function parseFrenchDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = text.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return undefined;
}

/**
 * Cherche une date d'établissement de DPE dans un texte libre
 * (« DPE réalisé le 12/03/2024 », « diagnostic effectué le … »). Renvoie l'ISO.
 */
export function extractDpeDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const near =
    text.match(/dpe[^.]{0,40}?(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i) ??
    text.match(/(?:réalisé|établi|effectué|valable)[^.]{0,20}?(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
  return near ? parseFrenchDate(near[1]) : undefined;
}
