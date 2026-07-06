import type { Listing, PropertyType } from "../types";
import {
  buildRawAddress,
  extractDpeDate,
  extractGesKgM2,
  extractKwhM2,
  toLetter,
  toNumber,
  toPropertyType,
  toStr,
} from "./mapping";

const UNKNOWN = "bienici: structure inconnue";

interface LdProductOffer {
  price?: unknown;
  priceSpecification?: { price?: unknown };
}

interface LdProduct {
  "@type"?: unknown;
  name?: unknown;
  image?: unknown;
  offers?: LdProductOffer | LdProductOffer[];
}

interface LdAccommodation {
  "@type"?: unknown;
  numberOfRooms?: unknown;
  floorSize?: { value?: unknown };
  address?: { addressLocality?: unknown; postalCode?: unknown };
}

function readLdJson(doc: Document): { product?: LdProduct; accommodation?: LdAccommodation } {
  const scripts = doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');
  let product: LdProduct | undefined;
  let accommodation: LdAccommodation | undefined;
  for (const script of scripts) {
    if (!script.textContent) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const type = (node as { "@type"?: unknown })["@type"];
      if (type === "Product" && !product) product = node as LdProduct;
      else if (type === "Accommodation" && !accommodation) accommodation = node as LdAccommodation;
    }
  }
  return { product, accommodation };
}

function readOfferPrice(offers: LdProduct["offers"]): number | undefined {
  const list: LdProductOffer[] = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    const direct = toNumber(offer.price);
    if (direct && direct > 0) return direct;
    const spec = toNumber(offer.priceSpecification?.price);
    if (spec && spec > 0) return spec;
  }
  return undefined;
}

function readDpeLetter(doc: Document, kind: "dpe" | "ges"): string | undefined {
  const node = doc.querySelector(`.${kind}-line.active .${kind}-line__classification`);
  return toLetter(node?.textContent);
}

/** Bloc texte du diagnostic énergie (porte parfois la valeur kWh / kg CO₂). */
function readEnergyText(doc: Document, kind: "dpe" | "ges"): string | undefined {
  const node = doc.querySelector(`.${kind}-line.active`) ?? doc.querySelector(`.${kind}-bloc`);
  return node?.textContent ?? undefined;
}

function readPropertyType(url: string, fallback?: string): PropertyType | undefined {
  if (/\/maison\//i.test(url)) return "Maison";
  if (/\/appartement\//i.test(url)) return "Appartement";
  return toPropertyType(fallback);
}

/**
 * Bloc « À propos de l'agence » : nom + adresse postale de l'AGENCE (pas du
 * bien) — sert au détecteur de marqueur « centré agence » côté résolveur.
 * Format affiché : « 20 Cr Balguerie Stuttenberg - 33300 Bordeaux ».
 */
function readAgency(doc: Document): { name?: string; address?: string } {
  const name = doc.querySelector(".agency-overview__info-name")?.textContent?.trim() || undefined;
  const raw = doc.querySelector(".agency-overview__contact-address")?.textContent?.trim();
  // Normalise le tiret séparateur « rue - CP ville » en virgule (géocodage BAN).
  const address = raw ? raw.replace(/\s+-\s+(\d{5})/, ", $1").replace(/\s+/g, " ") : undefined;
  return { name, address };
}

function readPhotos(doc: Document, primary?: string): string[] {
  const seen = new Set<string>();
  if (primary) seen.add(primary);
  for (const img of doc.querySelectorAll<HTMLImageElement>('img[src*="file.bienici"]')) {
    const src = img.getAttribute("src");
    if (src) seen.add(src);
  }
  return [...seen];
}

export function parseBienici(doc: Document, url: string): Listing {
  const { product, accommodation } = readLdJson(doc);
  if (!product) throw new Error(UNKNOWN);

  const price = readOfferPrice(product.offers);
  if (!price) throw new Error(UNKNOWN);

  const title = toStr(product.name) ?? "";
  const image = toStr(product.image);

  const surface = toNumber(accommodation?.floorSize?.value);
  const rooms = toNumber(accommodation?.numberOfRooms);
  const city = toStr(accommodation?.address?.addressLocality);
  const postalCode = toStr(accommodation?.address?.postalCode);

  // Valeurs numériques DPE/GES depuis le bloc diagnostic, sinon le titre.
  const dpeText = `${readEnergyText(doc, "dpe") ?? ""} ${title}`;
  const gesText = `${readEnergyText(doc, "ges") ?? ""} ${title}`;
  const dpeKwhM2 = extractKwhM2(dpeText);
  const gesKgCO2M2 = extractGesKgM2(gesText);
  // Bien'ici affiche « Date de réalisation du DPE : 5 décembre 2024 » dans un
  // bloc à part (hors .dpe-line) → on scanne tout le texte de la page.
  const dpeDate =
    extractDpeDate(doc.body?.textContent ?? "") ?? extractDpeDate(`${dpeText} ${title}`);

  const agency = readAgency(doc);

  return {
    url,
    site: "bienici",
    title,
    price,
    surface,
    rooms,
    propertyType: readPropertyType(url, title),
    location: {
      rawAddress: buildRawAddress(city, postalCode, undefined),
      city,
      postalCode,
    },
    dpe: readDpeLetter(doc, "dpe"),
    ges: readDpeLetter(doc, "ges"),
    dpeKwhM2,
    gesKgCO2M2,
    dpeDate,
    agencyName: agency.name,
    agencyAddress: agency.address,
    description: "",
    photos: readPhotos(doc, image),
    extractedAt: new Date().toISOString(),
  };
}
