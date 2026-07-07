import type { Listing, ListingGeo, PropertyType } from "../types.ts";
import { extractDpeDate, extractGesKgM2, extractKwhM2, toNumber, toPropertyType } from "./mapping.ts";

/**
 * Mappe le couple (coordonnées, type de localisation Leboncoin) vers un
 * `ListingGeo`. Leboncoin ne donne pas de rayon : on l'approxime depuis le
 * `location.type` (`housenumber`/`address` = point précis ; `street`/`district`/
 * `city` = disque de plus en plus large).
 */
function buildGeo(lat: unknown, lon: unknown, type: string | undefined): ListingGeo | undefined {
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  switch (type) {
    case "housenumber":
    case "address":
      return { lat, lon, precision: "gps" };
    case "street":
      return { lat, lon, radiusM: 150, precision: "disk" };
    case "district":
      return { lat, lon, radiusM: 600, precision: "disk" };
    case "city":
      return { lat, lon, radiusM: 2500, precision: "disk" };
    default:
      return { lat, lon, radiusM: 1500, precision: "disk" };
  }
}

export function isLeboncoinListingPage(url: string): boolean {
  return /leboncoin\.fr\/ad\/(ventes_immobilieres|immobilier)\/\d+/.test(url);
}

interface LbcAttribute {
  key: string;
  value: string;
  key_label?: string;
  value_label?: string;
  generic?: boolean;
}

function attr(attributes: LbcAttribute[], key: string): string | undefined {
  return attributes.find((a) => a.key === key)?.value;
}

function buildAttributes(
  attributes: LbcAttribute[],
): { label: string; value: string }[] {
  const result: { label: string; value: string }[] = [];
  for (const a of attributes.slice(0, 40)) {
    if (!a.key_label) continue; // skip purely technical entries without a human label
    const label = a.key_label;
    const value = a.value_label ?? a.value;
    result.push({ label, value });
  }
  return result;
}

function readNextData(doc: Document): Record<string, unknown> | null {
  const script = doc.querySelector("script#__NEXT_DATA__");
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseLeboncoinHtml(html: string, url: string): Listing {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return parseLeboncoin(doc, url);
}

export function parseLeboncoin(doc: Document, url: string): Listing {
  const data = readNextData(doc) as {
    props?: { pageProps?: { ad?: Record<string, unknown> } };
  } | null;
  const ad = data?.props?.pageProps?.ad;
  if (!ad) throw new Error("leboncoin: __NEXT_DATA__.props.pageProps.ad introuvable");

  const attributes = (ad.attributes ?? []) as LbcAttribute[];
  const location = (ad.location ?? {}) as Record<string, unknown>;
  const images = (ad.images ?? {}) as { urls?: string[] };

  const priceRaw = ad.price;
  const price = Array.isArray(priceRaw) ? Number(priceRaw[0]) : Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) throw new Error("leboncoin: prix illisible");

  const surfaceRaw = attr(attributes, "square");
  const roomsRaw = attr(attributes, "rooms");
  const bedroomsRaw = attr(attributes, "bedrooms");
  const landSurfaceRaw = attr(attributes, "land_plot_surface");
  // real_estate_type LBC : "1"=Maison, "2"=Appartement (observé sur fixture 2026-06).
  // Pour les autres types (immeuble, …) on dérive du libellé humain `value_label`,
  // puis du titre en dernier recours — évite de coder en dur des codes inconnus.
  const estateType = attr(attributes, "real_estate_type")?.toLowerCase();
  const estateLabel = attributes.find((a) => a.key === "real_estate_type")?.value_label;
  const propertyType: PropertyType | undefined =
    estateType === "1" || estateType === "maison"
      ? "Maison"
      : estateType === "2" || estateType === "appartement"
        ? "Appartement"
        : (toPropertyType(estateLabel) ?? toPropertyType(String(ad.subject ?? "")));

  const dpe = attr(attributes, "energy_rate")?.toUpperCase();
  const ges = attr(attributes, "ges")?.toUpperCase();

  // Valeurs numériques DPE/GES : clés structurées connues, sinon regex sur le
  // texte des attributs + la description (best-effort, undefined si absent).
  const energyBlob = [
    ...attributes.map((a) => a.value_label ?? a.value),
    String(ad.body ?? ""),
  ].join(" ");
  const dpeKwhM2 =
    toNumber(attr(attributes, "energy_consumption")) ?? extractKwhM2(energyBlob);
  const gesKgCO2M2 =
    toNumber(attr(attributes, "gas_emission")) ?? extractGesKgM2(energyBlob);
  const dpeDate = extractDpeDate(energyBlob);

  const builtAttributes = buildAttributes(attributes);

  return {
    url,
    site: "leboncoin",
    title: String(ad.subject ?? ""),
    price,
    surface: surfaceRaw ? Number(surfaceRaw) : undefined,
    rooms: roomsRaw ? Number(roomsRaw) : undefined,
    bedrooms: bedroomsRaw ? Number(bedroomsRaw) : undefined,
    landSurface: landSurfaceRaw ? Number(landSurfaceRaw) : undefined,
    propertyType,
    location: {
      rawAddress: [location.city, location.zipcode, location.district].filter(Boolean).join(" "),
      postalCode: location.zipcode ? String(location.zipcode) : undefined,
      city: location.city ? String(location.city) : undefined,
      district: location.district ? String(location.district) : undefined,
      precision: location.type ? String(location.type) : undefined,
      lat: typeof location.lat === "number" ? location.lat : undefined,
      lon: typeof location.lng === "number" ? location.lng : undefined,
    },
    geo: buildGeo(location.lat, location.lng, location.type ? String(location.type) : undefined),
    dpe: dpe && /^[A-G]$/.test(dpe) ? dpe : undefined,
    ges: ges && /^[A-G]$/.test(ges) ? ges : undefined,
    dpeKwhM2,
    gesKgCO2M2,
    dpeDate,
    description: String(ad.body ?? ""),
    photos: images.urls ?? [],
    publishedAt: ad.first_publication_date ? String(ad.first_publication_date) : undefined,
    extractedAt: new Date().toISOString(),
    attributes: builtAttributes.length > 0 ? builtAttributes : undefined,
  };
}
