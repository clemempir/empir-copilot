import { fetchAdemeCertificates } from "./ademe";
import { lookupParcel } from "./cadastre";
import { rankCertificates } from "./scorer";
import type { ResolvedAddress, ResolverInput } from "./types";

export type { ResolverInput, ResolvedAddress, MatchBreakdownItem } from "./types";

export interface ResolveAddressOptions {
  /** Nombre maximum de candidats retournés (défaut 5). */
  limit?: number;
  /** Activer le lookup cadastre pour le top-1 (défaut true). */
  withCadastre?: boolean;
  /** Injection fetch (tests). */
  fetchFn?: typeof fetch;
}

/**
 * Résout l'adresse réelle d'un bien à partir des indices de l'annonce, à la
 * manière de parcellai.re :
 *
 * 1. Requête la base ADEME DPE (filtrée par code postal + type de bâtiment).
 * 2. Score chaque certificat par correspondance pondérée (surface, DPE
 *    numérique, GES, année, type).
 * 3. Pour le top-1, croise avec le cadastre IGN pour récupérer la parcelle.
 * 4. Renvoie la liste classée par confiance décroissante.
 *
 * L'algorithme tourne idéalement côté Edge Function Supabase pour mutualiser
 * le cache et masquer les heuristiques (cf. plan task 5), mais ce module reste
 * appelable depuis n'importe quel runtime fetch.
 */
export async function resolveAddress(
  input: ResolverInput,
  opts: ResolveAddressOptions = {},
): Promise<ResolvedAddress[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 5;
  const withCadastre = opts.withCadastre ?? true;

  if (!input.postalCode) return [];

  const certs = await fetchAdemeCertificates({
    postalCode: input.postalCode,
    buildingType: input.propertyType,
    fetchFn,
  });

  const ranked = rankCertificates(input, certs, limit);

  const resolved: ResolvedAddress[] = await Promise.all(
    ranked.map(async ({ cert, confidence, breakdown }, idx) => {
      let parcelId: string | undefined;
      if (
        withCadastre &&
        idx === 0 &&
        cert.lat != null &&
        cert.lon != null
      ) {
        try {
          const parcel = await lookupParcel({ lat: cert.lat, lon: cert.lon, fetchFn });
          parcelId = parcel?.id;
        } catch {
          // cadastre best-effort
        }
      }
      return {
        address: cert.address,
        lat: cert.lat ?? 0,
        lon: cert.lon ?? 0,
        parcelId,
        ademeCertId: cert.certId,
        confidence,
        matchBreakdown: breakdown,
        verifiedDpe:
          cert.dpeClass && cert.dpeKwhM2 != null && cert.gesKgCO2M2 != null
            ? { class: cert.dpeClass, kwhM2: cert.dpeKwhM2, gesKgCO2M2: cert.gesKgCO2M2 }
            : undefined,
      };
    }),
  );

  return resolved;
}
