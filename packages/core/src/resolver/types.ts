export type DpeLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

/**
 * Indice de localisation issu de l'annonce (marqueur carte, centre de floutage…).
 * `radiusM` petit ou absent ⇒ point précis ; grand ⇒ disque de floutage.
 */
export interface GeoHint {
  lat: number;
  lon: number;
  /** Rayon d'incertitude en mètres (centre de floutage). Absent ⇒ point précis. */
  radiusM?: number;
  /** Type déclaré par la source quand disponible (Bien'ici : `gps` vs `disk`). */
  precision?: "gps" | "disk";
}

/** Entrée du résolveur d'adresse — extraite de l'annonce + métadonnées. */
export interface ResolverInput {
  postalCode: string;
  city?: string;
  /** Surface habitable en m² (ADEME : `surface_habitable_logement`). */
  surface?: number;
  rooms?: number;
  yearBuilt?: number;
  /** Lettre A-G affichée sur l'annonce — moins précis que la valeur kWh/m²/an. */
  dpeClass?: DpeLetter;
  /** kWh/m²/an (consommation énergie primaire). */
  dpeKwhM2?: number;
  /** kg CO₂/m²/an (émissions GES). */
  gesKgCO2M2?: number;
  /** Lettre A-G GES affichée sur l'annonce — fallback quand le chiffre manque. */
  gesClass?: DpeLetter;
  /** Surface du terrain en m² (annonce) — comparée à la contenance cadastrale. */
  landSurface?: number;
  /** Date d'établissement / d'affichage du DPE annoncé (ISO `yyyy-mm-dd`). */
  dpeDate?: string;
  /** Nombre de logements annoncé (immeuble) si exposé. */
  apartmentCount?: number;
  /** Type de bien d'après l'annonce. */
  propertyType?: "Appartement" | "Maison" | "Immeuble";
  /** Localisation approximative issue de l'annonce (marqueur / floutage). */
  geo?: GeoHint;
}

export interface MatchBreakdownItem {
  criterion: string;
  /** Concordance binaire (similarité ≥ seuil serré) — rétro-compat / lisibilité. */
  matched: boolean;
  /** Valeur attendue (annonce) vs valeur trouvée (certificat) — explicabilité. */
  expected?: string | number;
  actual?: string | number;
  // ── Scoring adaptatif ────────────────────────────────────────────────────
  /** Similarité continue sim_k ∈ [0,1] (1 = dans la tolérance serrée). */
  similarity?: number;
  /** Fiabilité intrinsèque du critère w_k (constante). */
  weight?: number;
  /** Pouvoir discriminant local : rareté de la valeur de l'annonce dans le vivier. */
  selectivity?: number;
  /** Contribution au score = w_k · sim_k · selectivity_k. */
  contribution?: number;
  /** Distance au marqueur de l'annonce, pour le pseudo-critère géo. */
  distanceM?: number;
}

/** Drapeaux d'explicabilité sur la décision de résolution. */
export type ResolveFlag =
  | "geo-decided" // l'adresse est tranchée par le marqueur seul
  | "dpe-confirmed" // le DPE corrobore la position
  | "dpe-absent" // aucun DPE au point — adresse probable mais non vérifiée
  | "conflict" // le DPE au point contredit l'annonce
  | "low-margin"; // écart insuffisant entre les 2 meilleures adresses

export interface ResolvedAddress {
  /** Adresse formatée (`18 rue Béranger, 75003 Paris`). */
  address: string;
  lat: number;
  lon: number;
  /** Référence cadastrale (`75103000AB0042`) si disponible. */
  parcelId?: string;
  /** ID du certificat ADEME source. */
  ademeCertId?: string;
  /** 0-100, confiance combinée (marge d'attributs × corroboration géo). */
  confidence: number;
  /** Adresse considérée comme résolue (anti-faux-positif). Sinon : candidat. */
  resolved: boolean;
  /** Distance au marqueur de l'annonce en mètres, si `geo` fourni. */
  distanceM?: number;
  /** Drapeaux d'explicabilité (géo/DPE). */
  flags?: ResolveFlag[];
  matchBreakdown: MatchBreakdownItem[];
  /** DPE issu de la base ADEME (à comparer au DPE annoncé). */
  verifiedDpe?: {
    class: DpeLetter;
    kwhM2: number;
    gesKgCO2M2: number;
  };
}
