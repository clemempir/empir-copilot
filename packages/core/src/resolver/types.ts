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
  /**
   * Le marqueur est-il un point GPS exploitable comme gate serré (SeLoger) plutôt
   * qu'un disque de floutage (Bien'ici) ? Prioritaire sur `precision`/`radiusM`.
   */
  precise?: boolean;
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

/**
 * Facteur d'un croisement : la similarité d'un attribut membre du combo, avec
 * sa valeur annonce/certificat pour l'explicabilité fine.
 */
export interface MatchFactor {
  criterion: string;
  similarity: number;
  expected?: string | number;
  actual?: string | number;
}

/**
 * Une ligne de `matchBreakdown` représente désormais un CROISEMENT (combo), pas
 * un critère isolé. Sa contribution = valeur du combo × sélectivité locale, et la
 * somme des contributions reproduit le score attributaire à la main.
 */
export interface MatchBreakdownItem {
  /** Libellé du combo (`épine`, `épine×ges`, `terrain`…) ou `_geo`. */
  criterion: string;
  /** Le combo « s'allume »-t-il (tous ses facteurs concordants) ? */
  matched: boolean;
  /** Valeur attendue/trouvée du facteur distinctif (combos mono-facteur). */
  expected?: string | number;
  actual?: string | number;
  /** Valeur du combo = produit des similarités de ses membres ∈ [0,1]. */
  similarity?: number;
  /** Pouvoir discriminant local du combo : rareté dans le vivier P. */
  selectivity?: number;
  /** Contribution additive au score = similarity · selectivity. */
  contribution?: number;
  /** Facteurs (membres) du combo, avec leur similarité individuelle. */
  factors?: MatchFactor[];
  /** Coefficient géo multiplicatif (ligne `_geo` uniquement). */
  geoCoef?: number;
  /** Distance au marqueur de l'annonce (ligne `_geo`). */
  distanceM?: number;
}

/** Drapeaux d'explicabilité sur la décision de résolution. */
export type ResolveFlag =
  | "geo-decided" // l'adresse est tranchée par le marqueur seul
  | "geo-corroborated" // le marqueur précis ET le DPE concordent
  | "dpe-confirmed" // le DPE corrobore la position
  | "dpe-absent" // aucun DPE au point — adresse probable mais non vérifiée
  | "conflict" // le DPE au point contredit l'annonce
  | "low-margin" // écart insuffisant entre les 2 meilleures adresses
  | "lot-in-building" // pas de DPE de lot ; DPE d'immeuble concordant à proximité
  | "dpe-fingerprint"; // conso exacte (à l'arrondi) unique dans la commune

/**
 * Statut de résolution (remplace le booléen `resolved`).
 *   confirmed  : marge forte + signal discriminant (combo rare OU géo précise
 *                corroborée), sans contradiction → adresse fiable.
 *   probable   : le top-1 se détache mais sans signal fort → à confirmer.
 *   unresolved : marge insuffisante, contradiction, ou bien absent de la base.
 */
export type ResolveStatus = "confirmed" | "probable" | "unresolved";

export interface ResolvedAddress {
  /** Adresse formatée (`18 rue Béranger, 75003 Paris`). */
  address: string;
  lat: number;
  lon: number;
  /** Référence cadastrale (`75103000AB0042`) si disponible. */
  parcelId?: string;
  /** ID du certificat ADEME source. */
  ademeCertId?: string;
  /** 0-100, confiance combinée (accumulation + marge, accordée à la géo). */
  confidence: number;
  /** Statut de résolution — source de vérité (cf. {@link ResolveStatus}). */
  status: ResolveStatus;
  /**
   * @deprecated Dérivé de `status` (=== "confirmed"). Conservé pour la
   * rétro-compat UI ; préférer `status`.
   */
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
    /** Surface habitable réelle du certificat (à comparer à la surface annoncée). */
    surfaceM2?: number;
  };
}
