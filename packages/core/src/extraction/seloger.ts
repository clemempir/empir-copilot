import type { Listing, ListingGeo } from "../types";
import {
  buildRawAddress,
  extractDpeDate,
  extractGesKgM2,
  extractKwhM2,
  extractSelogerGeo,
  toLetter,
  toNumber,
  toPropertyType,
  toStr,
} from "./mapping";

const UNKNOWN = "seloger: structure inconnue";

export function isSelogerListingPage(url: string): boolean {
  // Deux formats d'annonce SeLoger :
  //   /annonces/{transaction}/{type}/{ville-cp}/{id}.htm   (canonique)
  //   /{id}/detail.htm?serp_view=list…                     (vue détail depuis la SERP)
  return /seloger\.com\/(annonces\/[^?#]*\/\d+\.htm|\d+\/detail\.htm)/.test(url);
}

// ── Types for the __UFRN_LIFECYCLE_SERVERREQUEST__ state ──────────────────

interface SelogerFact {
  type: string;
  splitValue?: string;
}

/**
 * Barème énergie SeLoger. Deux formats coexistent :
 *   – ancien : `{ name, rating, value }` (rating = lettre, souvent absent → DOM) ;
 *   – nouveau : `{ efficiencyClass: { rating }, values: [{ value, label }] }`
 *     où `values` porte la conso (« 127 kWh/m².an ») et les émissions
 *     (« 4 kg CO₂/m².an »). DPE et GES sont alors deux scales du MÊME certificat.
 */
interface SelogerScale {
  name?: string;
  rating?: string;
  value?: string;
  efficiencyClass?: { index?: number; rating?: string };
  values?: Array<{ value?: string; label?: string }>;
}

interface SelogerCategoryElement {
  icon?: string;
  value: string;
}

interface SelogerCategory {
  title: string;
  elements: SelogerCategoryElement[];
}

interface SelogerState {
  app_cldp?: {
    data?: {
      classified?: {
        metadata?: { creationDate?: string };
        rawData?: { propertyTypeLabel?: string; propertyType?: string };
        legacyTracking?: {
          products?: Array<{
            price?: number;
            space?: number;
            nb_rooms?: number;
            nb_bedrooms?: number;
            estate_postalcode?: string;
          }>;
        };
        sections?: {
          hardFacts?: { title?: string; facts?: SelogerFact[] };
          location?: { address?: { city?: string; zipCode?: string } };
          description?: { description?: string };
          gallery?: { images?: Array<{ url?: string }> };
          energy?: {
            certificates?: Array<{ scales?: SelogerScale[] }>;
          };
          features?: {
            details?: { categories?: SelogerCategory[] };
          };
          price?: {
            base?: { main?: { value?: { main?: { ariaLabel?: string } } } };
          };
        };
      };
    };
  };
}

/**
 * Parse the __UFRN_LIFECYCLE_SERVERREQUEST__ state from a raw script text.
 * The script content looks like:
 *   window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("{\"app_cldp\":{...}}");
 * The argument is a JSON-encoded string (doubly escaped), so we match the full
 * JS string literal (handling \" escapes) and JSON.parse it twice.
 */
function parseStateFromText(text: string): SelogerState | null {
  if (!text.includes("__UFRN_LIFECYCLE_SERVERREQUEST__")) return null;
  // Match a JS string literal: "..." where \" is an escaped quote
  const m = text.match(
    /__UFRN_LIFECYCLE_SERVERREQUEST__[^=]*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/,
  );
  if (!m || !m[1]) return null;
  try {
    // m[1] is e.g. "{\"app_cldp\":{...}}" — JSON.parse gives the inner JSON string
    const jsonStr = JSON.parse(m[1]) as string;
    return JSON.parse(jsonStr) as SelogerState;
  } catch {
    return null;
  }
}

function readStateFromHtml(html: string): SelogerState | null {
  // Split the raw HTML on script boundaries and probe each script block
  // This avoids relying on DOM parsing (which may drop large inline scripts)
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const block = match[1];
    if (!block) continue;
    const state = parseStateFromText(block);
    if (state) return state;
  }
  return null;
}

function readState(doc: Document): SelogerState | null {
  // In a live browser context (content-script), scripts are present in the DOM.
  const scripts = doc.querySelectorAll<HTMLScriptElement>("script:not([src])");
  for (const script of scripts) {
    const state = parseStateFromText(script.textContent ?? "");
    if (state) return state;
  }
  return null;
}

function findFact(facts: SelogerFact[], type: string): number | undefined {
  const f = facts.find((x) => x.type === type);
  // `splitValue` peut porter un séparateur de milliers (« 40 000 ») → toNumber.
  return toNumber(f?.splitValue);
}

function buildAttributes(
  categories: SelogerCategory[],
): { label: string; value: string }[] {
  const result: { label: string; value: string }[] = [];
  for (const cat of categories) {
    for (const el of cat.elements) {
      if (el.value?.trim()) {
        result.push({ label: cat.title, value: el.value });
      }
    }
  }
  return result;
}

const RE_KWH = /kwh/i;
const RE_CO2 = /co₂|co2|kg/i;

/** Lettre A-G d'un barème : `efficiencyClass.rating` (nouveau) ou `rating`/`value` (ancien). */
function scaleLetter(s: SelogerScale): string | undefined {
  return toLetter(s.efficiencyClass?.rating ?? s.rating ?? s.value);
}

/** Le barème porte-t-il une valeur matchant `re` (sert à distinguer scale DPE/GES) ? */
function scaleHasValue(s: SelogerScale, re: RegExp): boolean {
  return (s.values ?? []).some((v) => v.value != null && re.test(v.value));
}

/** Premier nombre > 0 d'un barème dont la valeur matche `re` (« 328 kWh/m².an » → 328). */
function scaleNumber(s: SelogerScale, re: RegExp): number | undefined {
  for (const v of s.values ?? []) {
    if (v.value && re.test(v.value)) {
      const n = toNumber(v.value);
      if (n != null && n > 0) return n;
    }
  }
  // Ancien format : `value` porte directement le chiffre.
  if (s.value) {
    const n = toNumber(s.value);
    if (n != null && n > 0) return n;
  }
  return undefined;
}

/**
 * Extrait DPE/GES (lettres ET chiffres) des barèmes énergie, robuste aux deux
 * structures SeLoger :
 *   – nouveau : DPE et GES sont deux scales du même certificat ; le scale DPE
 *     porte une valeur « kWh », le scale GES une valeur « CO₂ » seule ;
 *   – ancien : un certificat par indicateur (`certificates[0]`=DPE, `[1]`=GES).
 *
 * NB : le CHIFFRE « kWh/m².an » du barème EST la vraie conso du DPE (vérifié :
 * 127→Papin, 328→3bis Rue de la Paix, exacts) — c'est le signal le plus
 * discriminant. À ne pas confondre avec l'« estimation de la facture €/an »
 * (feature `minMaxEstimation`), elle réellement estimée et non extraite.
 */
function parseEnergyScales(certificates: Array<{ scales?: SelogerScale[] }>): {
  dpe?: string;
  ges?: string;
  dpeKwhM2?: number;
  gesKgCO2M2?: number;
} {
  const scales = certificates.flatMap((c) => c.scales ?? []);

  // Scale DPE = celui qui porte une conso en kWh ; GES = un autre avec du CO₂.
  const dpeScale = scales.find((s) => scaleHasValue(s, RE_KWH));
  const gesScale = scales.find((s) => s !== dpeScale && scaleHasValue(s, RE_CO2));

  let dpe = dpeScale ? scaleLetter(dpeScale) : undefined;
  let ges = gesScale ? scaleLetter(gesScale) : undefined;
  // Repli ancien format (un certificat par indicateur, lettre seule).
  if (!dpe) dpe = scaleLetter(certificates[0]?.scales?.[0] ?? {});
  if (!ges) ges = scaleLetter(certificates[1]?.scales?.[0] ?? {});

  const dpeKwhM2 = dpeScale ? scaleNumber(dpeScale, RE_KWH) : undefined;
  // GES chiffré : scale GES dédié, sinon la valeur CO₂ portée par le scale DPE.
  const gesKgCO2M2 = gesScale
    ? scaleNumber(gesScale, RE_CO2)
    : dpeScale
      ? scaleNumber(dpeScale, RE_CO2)
      : undefined;

  return { dpe, ges, dpeKwhM2, gesKgCO2M2 };
}

/**
 * Fallback DOM : sur les pages où l'état `__UFRN` ne porte pas le DPE, SeLoger
 * affiche les lettres dans deux barèmes `cdp-preview-scale-highlighted`
 * (1er = DPE, 2e = GES). On lit le texte de la pastille surlignée.
 */
function extractDpeGesFromDom(raw: string): { dpe?: string; ges?: string } {
  const letters = [...raw.matchAll(/cdp-preview-scale-highlighted[^>]*>\s*([A-G])\s*</g)].map(
    (m) => m[1],
  );
  return { dpe: letters[0], ges: letters[1] };
}

function buildListing(state: SelogerState, url: string, rawSource: string): Listing {
  const classified = state.app_cldp?.data?.classified;
  if (!classified) throw new Error(UNKNOWN);
  if (!state) throw new Error(UNKNOWN);

  const ltProduct = classified.legacyTracking?.products?.[0];
  const sections = classified.sections;
  const rawData = classified.rawData;

  // Price — prefer numeric legacyTracking, fallback to ariaLabel string
  let price: number | undefined = ltProduct?.price ?? undefined;
  if (!price || price <= 0) {
    const ariaLabel = sections?.price?.base?.main?.value?.main?.ariaLabel;
    price = toNumber(ariaLabel);
  }
  if (!price || price <= 0) throw new Error(UNKNOWN);

  // Surface, rooms, bedrooms from legacyTracking (cleanest numeric source)
  const surface = ltProduct?.space ?? undefined;
  const rooms = ltProduct?.nb_rooms ?? undefined;
  const bedrooms = ltProduct?.nb_bedrooms ?? undefined;

  // Surface du terrain : exposée uniquement dans hardFacts (fact `plotSpace`),
  // absente de legacyTracking. Présente sur les maisons / biens avec terrain.
  const facts = sections?.hardFacts?.facts ?? [];
  const landSurface = findFact(facts, "plotSpace");

  // Location
  const locAddr = sections?.location?.address;
  const city = toStr(locAddr?.city);
  const postalCode = toStr(locAddr?.zipCode) ?? toStr(ltProduct?.estate_postalcode);

  // Localisation : overlay carte Mapbox (point précis ou polygone de floutage).
  const geo: ListingGeo | undefined = extractSelogerGeo(rawSource);

  // Title
  const title = toStr(sections?.hardFacts?.title) ?? "";

  // Property type — état `__UFRN` en priorité ; sinon dérivé du titre
  // (« Maison à vendre », « Appartement 3 pièces… ») absent sur certaines pages.
  const propTypeStr = toStr(rawData?.propertyTypeLabel) ?? toStr(rawData?.propertyType);
  const propertyType = toPropertyType(propTypeStr) ?? toPropertyType(title);

  // Description
  const description = toStr(sections?.description?.description) ?? "";

  // Photos
  const photos = (sections?.gallery?.images ?? [])
    .map((img) => img.url)
    .filter((u): u is string => typeof u === "string");

  // DPE / GES — barèmes énergie (absents pour les biens exemptés).
  const certificates = sections?.energy?.certificates ?? [];
  const energy = parseEnergyScales(certificates);
  // Lettres DPE/GES : état `__UFRN` en priorité, sinon fallback DOM (pastilles
  // surlignées du bloc énergie, présentes même quand l'état ne porte rien).
  const domLetters = extractDpeGesFromDom(rawSource);
  const dpe = energy.dpe ?? domLetters.dpe;
  const ges = energy.ges ?? domLetters.ges;
  // Valeurs numériques DPE/GES : barème énergie (vraie conso du DPE) en priorité,
  // sinon regex sur la description libre.
  const dpeKwhM2 = energy.dpeKwhM2 ?? extractKwhM2(description);
  const gesKgCO2M2 = energy.gesKgCO2M2 ?? extractGesKgM2(description);
  const dpeDate = extractDpeDate(description);

  // Attributes from features.details.categories
  const categories = sections?.features?.details?.categories ?? [];
  const attrs = buildAttributes(categories);

  return {
    url,
    site: "seloger",
    title,
    price,
    surface: surface ? Number(surface) : undefined,
    rooms: rooms ? Number(rooms) : undefined,
    bedrooms: bedrooms ? Number(bedrooms) : undefined,
    landSurface,
    propertyType,
    location: {
      rawAddress: buildRawAddress(city, postalCode, undefined),
      city,
      postalCode,
    },
    dpe,
    ges,
    dpeKwhM2,
    gesKgCO2M2,
    dpeDate,
    geo,
    description,
    photos,
    publishedAt: toStr(classified.metadata?.creationDate),
    extractedAt: new Date().toISOString(),
    attributes: attrs.length > 0 ? attrs : undefined,
  };
}

/** Parse from a live browser Document (content-script context). */
export function parseSeloger(doc: Document, url: string): Listing {
  const state = readState(doc);
  if (!state) throw new Error(UNKNOWN);
  // outerHTML inclut scripts + img Mapbox → suffisant pour le géo.
  const raw = doc.documentElement?.outerHTML ?? "";
  return buildListing(state, url, raw);
}

/** Parse from a raw HTML string (fixture tests, server-side). */
export function parseSelogerHtml(html: string, url: string): Listing {
  const state = readStateFromHtml(html);
  if (!state) throw new Error(UNKNOWN);
  return buildListing(state, url, html);
}
