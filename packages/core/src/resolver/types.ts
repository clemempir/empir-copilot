/** Entrée du résolveur d'adresse — extraite de l'annonce + métadonnées. */
export interface ResolverInput {
  postalCode: string;
  city?: string;
  /** Surface habitable en m² (ADEME : `surface_habitable_logement`). */
  surface?: number;
  rooms?: number;
  yearBuilt?: number;
  /** Lettre A-G affichée sur l'annonce — moins précis que la valeur kWh/m²/an. */
  dpeClass?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  /** kWh/m²/an (consommation énergie primaire). */
  dpeKwhM2?: number;
  /** kg CO₂/m²/an (émissions GES). */
  gesKgCO2M2?: number;
  landSurface?: number;
  /** Type de bien d'après l'annonce (filtre ADEME). */
  propertyType?: "Appartement" | "Maison";
}

export interface MatchBreakdownItem {
  criterion: string;
  weight: number;
  matched: boolean;
  /** Valeur attendue vs valeur trouvée (debug / explainability). */
  expected?: string | number;
  actual?: string | number;
}

export interface ResolvedAddress {
  /** Adresse formatée (`18 rue Béranger, 75003 Paris`). */
  address: string;
  lat: number;
  lon: number;
  /** Référence cadastrale (`75103000AB0042`) si disponible. */
  parcelId?: string;
  /** ID du certificat ADEME source. */
  ademeCertId?: string;
  /** 0-100, somme pondérée des critères matchés. */
  confidence: number;
  matchBreakdown: MatchBreakdownItem[];
  /** DPE issu de la base ADEME (à comparer au DPE annoncé). */
  verifiedDpe?: {
    class: "A" | "B" | "C" | "D" | "E" | "F" | "G";
    kwhM2: number;
    gesKgCO2M2: number;
  };
}
