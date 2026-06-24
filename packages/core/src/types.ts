export type Site = "leboncoin" | "seloger" | "bienici" | "citya" | "generic";
export type PropertyType = "Appartement" | "Maison";

export interface ListingLocation {
  rawAddress: string;
  postalCode?: string;
  city?: string;
  district?: string;
  precision?: string;
  lat?: number;
  lon?: number;
  locationCorrected?: true;
}

export interface Listing {
  url: string;
  site: Site;
  title: string;
  price: number;
  surface?: number;
  rooms?: number;
  bedrooms?: number;
  landSurface?: number;
  propertyType?: PropertyType;
  location: ListingLocation;
  dpe?: string;
  ges?: string;
  description: string;
  photos: string[];
  publishedAt?: string;
  extractedAt: string;
  attributes?: { label: string; value: string }[];
  userNotes?: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  citycode: string;
  label: string;
  score: number;
  precision: "housenumber" | "street" | "locality" | "municipality";
}

export interface DvfSale {
  idMutation: string;
  date: string;
  price: number;
  surface: number;
  rooms: number;
  pricePerM2: number;
  type: PropertyType;
  lat: number;
  lon: number;
  address: string;
}

export interface Comparable extends DvfSale {
  distanceM: number;
  similar?: boolean;
}

export interface MarketStats {
  medianPricePerM2: number;
  p25PricePerM2?: number;
  p75PricePerM2?: number;
  sampleSize: number;
  radiusM: number;
  confidence: "high" | "medium" | "low";
  comparables: Comparable[];
  medianOnSimilar?: boolean;
  windowMonths?: number;
}

export interface QuickAnalysis {
  listingPricePerM2: number | null;
  marketGapPct: number | null;
  market: MarketStats | null;
  score: number | null;
  scoreLabel: string;
}

export interface RiskItem {
  libelle: string;
  statut: string;
}

export interface RiskReport {
  naturels: RiskItem[];
  technologiques: RiskItem[];
}

export interface CommuneInfo {
  nom: string;
  population: number;
  densityPerKm2: number;
}

export interface PluZone {
  libelle: string;
  typezone: string;
}

export interface TaxeFonciereInfo {
  exercice: string;
  tauxGlobalTfb: number;
  tauxTeom: number | null;
}

export interface Enrichments {
  risks?: RiskReport;
  commune?: CommuneInfo;
  plu?: PluZone | null;
  taxeFonciere?: TaxeFonciereInfo | null;
}

export interface Report {
  id: string;
  listingUrl: string;
  createdAt: string;
  listing: Listing;
  quick: QuickAnalysis;
  enrichments?: Enrichments;
  resolvedAddress?: import("./resolver/types").ResolvedAddress;
}
