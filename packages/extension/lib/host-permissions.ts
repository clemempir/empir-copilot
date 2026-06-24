/**
 * Sites d'annonces sur lesquels EMPIR s'active (content script + host permissions).
 * Ajoute un site ici pour étendre la couverture.
 */
export const LISTING_MATCHES = [
  "https://www.leboncoin.fr/*",
  "https://www.seloger.com/*",
  "https://www.bienici.com/*",
  "https://www.citya.com/*",
] as const;

/**
 * Domaines des APIs publiques appelées depuis l'extension (fetch direct si l'algo
 * est exécuté côté client) ou listées en commentaire si l'appel passe par
 * Supabase Edge Functions.
 */
export const HOST_PERMISSIONS = [
  ...LISTING_MATCHES,
  // BAN / Géoplateforme — geocoding
  "https://api-adresse.data.gouv.fr/*",
  // DVF — ventes immobilières
  "https://files.data.gouv.fr/*",
  // ADEME — base DPE publique
  "https://data.ademe.fr/*",
  // IGN apicarto — cadastre + PLU
  "https://apicarto.ign.fr/*",
  // Géorisques
  "https://www.georisques.gouv.fr/*",
  // geo.api.gouv.fr — communes
  "https://geo.api.gouv.fr/*",
  // data.economie.gouv.fr — taxe foncière
  "https://data.economie.gouv.fr/*",
];
