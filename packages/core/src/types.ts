export type Site = "leboncoin" | "seloger" | "bienici" | "citya" | "generic";
export type PropertyType = "Appartement" | "Maison" | "Immeuble";

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

/**
 * Indice de localisation extrait de l'annonce (marqueur carte, centre de
 * floutage). `radiusM` petit/absent ⇒ point précis ; grand ⇒ disque.
 */
export interface ListingGeo {
  lat: number;
  lon: number;
  radiusM?: number;
  precision?: "gps" | "disk";
  /** Marqueur GPS publié (adresse exacte) ⇒ gate serré côté résolveur. */
  precise?: boolean;
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
  /** Consommation énergie primaire annoncée (kWh/m²/an) si exposée par l'annonce. */
  dpeKwhM2?: number;
  /** Émissions GES annoncées (kg CO₂/m²/an) si exposées par l'annonce. */
  gesKgCO2M2?: number;
  /** Date d'établissement du DPE (ISO `yyyy-mm-dd`) si affichée. */
  dpeDate?: string;
  /** Nombre de logements (immeuble) si l'annonce l'expose. */
  apartmentCount?: number;
  /** Localisation approximative (marqueur carte / centre de floutage). */
  geo?: ListingGeo;
  /** Nom de l'agence / annonceur professionnel si affiché. */
  agencyName?: string;
  /**
   * Adresse postale de l'AGENCE (pas du bien) si affichée. Sert au détecteur
   * de marqueur erroné : géocodée puis comparée au marqueur carte.
   */
  agencyAddress?: string;
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

/** Échelle de qualité ADEME (isolation / menuiseries). */
export type DpeQuality = "insuffisante" | "moyenne" | "bonne" | "très bonne";

/** Poste de déperdition thermique (pour le « point faible »). */
export type DpePoste = "murs" | "toiture" | "plancherBas" | "fenetres";

export interface DpeDetails {
  /** Type de générateur de chauffage principal (ex. « Chaudière gaz à condensation »). */
  chauffage?: string;
  /** Énergie principale de chauffage (ex. « Gaz naturel »). */
  energieChauffage?: string;
  /** Qualité d'isolation de l'enveloppe (globale). */
  isolation?: DpeQuality;
  /** Isolation des murs. */
  isolationMurs?: DpeQuality;
  /** Isolation de la toiture / combles (variantes ADEME coalescées). */
  isolationToiture?: DpeQuality;
  /** Isolation du plancher bas (sol). */
  isolationPlancherBas?: DpeQuality;
  /** Qualité d'isolation des menuiseries (proxy simple/double vitrage). */
  fenetres?: DpeQuality;
  /**
   * Poste où l'on perd le plus de chaleur PARMI les postes mal notés
   * (insuffisant/moyen). `undefined` si tout est bien isolé.
   */
  pointFaible?: DpePoste;
}

export interface CoproprieteInfo {
  isCopropriete: true;
  /** Nombre total de lots de la copropriété. */
  lotsTotal: number;
  /** Dont lots à usage d'habitation, si connu. */
  lotsHabitation?: number;
  /** Nom d'usage de la copropriété (en réserve, non affiché en v1). */
  nom?: string;
}

export interface Enrichments {
  risks?: RiskReport;
  commune?: CommuneInfo;
  plu?: PluZone | null;
  taxeFonciere?: TaxeFonciereInfo | null;
  copropriete?: CoproprieteInfo | null;
}

export interface Report {
  id: string;
  listingUrl: string;
  createdAt: string;
  listing: Listing;
  quick: QuickAnalysis;
  enrichments?: Enrichments;
  resolvedAddress?: import("./resolver/types.ts").ResolvedAddress;
}
