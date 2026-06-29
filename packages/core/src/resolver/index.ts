import { fetchAdemeCertificates } from "./ademe";
import { lookupParcel, type Parcel } from "./cadastre";
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
 * 2. Score chaque certificat par correspondance pondérée (surface, DPE/GES
 *    numériques ou lettres, année, date DPE, type).
 * 3. Passe 2 « maisons » : si l'annonce fournit une surface de terrain, croise
 *    le top-N avec le cadastre IGN pour récupérer la contenance des parcelles,
 *    puis re-score en intégrant le critère `landSurface`.
 * 4. Pour le top-1, attache la référence parcellaire.
 * 5. Renvoie la liste classée par confiance décroissante.
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

  // Passe 1 — scoring sans terrain. On garde un vivier un peu plus large que la
  // limite finale pour que la passe 2 puisse réordonner sur la contenance.
  let ranked = rankCertificates(input, certs, Math.max(limit, 5));

  // Mémorise les parcelles déjà résolues pour réutiliser leur `id` au top-1.
  const parcelByCertId = new Map<string, Parcel>();

  // Passe 2 — surface du terrain (maisons seulement). Garde-fou coût : on ne
  // déclenche les lookups cadastre que si l'annonce fournit `landSurface`.
  const useLandSurface =
    withCadastre &&
    input.landSurface != null &&
    input.propertyType === "Maison";

  if (useLandSurface) {
    await Promise.all(
      ranked.map(async ({ cert }) => {
        if (cert.lat == null || cert.lon == null) return;
        try {
          const parcel = await lookupParcel({ lat: cert.lat, lon: cert.lon, fetchFn });
          if (parcel) {
            parcelByCertId.set(cert.certId, parcel);
            if (parcel.contenance != null) cert.landSurface = parcel.contenance;
          }
        } catch {
          // cadastre best-effort
        }
      }),
    );
    // Re-score avec la contenance renseignée, puis coupe à la limite finale.
    ranked = rankCertificates(input, ranked.map((r) => r.cert), limit);
  } else {
    ranked = ranked.slice(0, limit);
  }

  const resolved: ResolvedAddress[] = await Promise.all(
    ranked.map(async ({ cert, confidence, breakdown }, idx) => {
      let parcelId = parcelByCertId.get(cert.certId)?.id;
      if (
        withCadastre &&
        idx === 0 &&
        parcelId == null &&
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
