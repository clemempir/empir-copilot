import { useEffect, useState } from "react";
import {
  citycodeFromLatLon,
  computeMarketStats,
  fetchCommuneSales,
  type Listing,
  type MarketStats,
  type ResolvedAddress,
} from "@empir/core";

export interface UseMarket {
  market: MarketStats | null;
  loading: boolean;
}

/**
 * Prix du marché du QUARTIER pour un bien : ventes DVF réelles autour du point
 * résolu, même type (maison/appartement), surface proche, rayon élargi si trop
 * peu de ventes — toute la logique est dans `computeMarketStats`.
 *
 * Tourne côté client (le core est importable ; DVF/geo.api sont publics et
 * autorisés dans host-permissions). Centre = adresse résolue si dispo, sinon le
 * marqueur de l'annonce.
 */
export function useMarket(
  listing: Listing | null | undefined,
  resolvedAddress: ResolvedAddress | undefined,
): UseMarket {
  const [market, setMarket] = useState<MarketStats | null>(null);
  const [loading, setLoading] = useState(false);

  const type = listing?.propertyType;
  const lat = resolvedAddress?.lat || listing?.geo?.lat;
  const lon = resolvedAddress?.lon || listing?.geo?.lon;

  useEffect(() => {
    // DVF ne couvre que maisons/appartements (pas les immeubles), et il faut un point.
    if (!listing || (type !== "Appartement" && type !== "Maison") || !lat || !lon) {
      setMarket(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const citycode = await citycodeFromLatLon(lat, lon);
        if (!citycode) {
          if (!cancelled) setMarket(null);
          return;
        }
        const sales = await fetchCommuneSales(citycode);
        const stats = computeMarketStats(sales, { lat, lon }, type, { surface: listing.surface });
        if (!cancelled) setMarket(stats);
      } catch {
        if (!cancelled) setMarket(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listing, type, lat, lon]);

  return { market, loading };
}
