import { useEffect, useState } from "react";
import {
  buildSaleTimeline,
  citycodeFromLatLon,
  computeMarketStats,
  fetchCommuneSales,
  propertySaleHistory,
  type Listing,
  type MarketStats,
  type ResolvedAddress,
  type SaleTimeline,
} from "@empir/core";

export interface UseMarket {
  market: MarketStats | null;
  /** Historique de vente du bien (frise : ventes passées + prix affiché). */
  timeline: SaleTimeline | null;
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
  const [timeline, setTimeline] = useState<SaleTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  const type = listing?.propertyType;
  const lat = resolvedAddress?.lat || listing?.geo?.lat;
  const lon = resolvedAddress?.lon || listing?.geo?.lon;

  useEffect(() => {
    // DVF ne couvre que maisons/appartements (pas les immeubles), et il faut un point.
    if (!listing || (type !== "Appartement" && type !== "Maison") || !lat || !lon) {
      setMarket(null);
      setTimeline(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const citycode = await citycodeFromLatLon(lat, lon);
        if (!citycode) {
          if (!cancelled) {
            setMarket(null);
            setTimeline(null);
          }
          return;
        }
        const sales = await fetchCommuneSales(citycode);
        const stats = computeMarketStats(sales, { lat, lon }, type, { surface: listing.surface });
        // Historique du bien : ventes passées à cette adresse + prix affiché aujourd'hui.
        const history = propertySaleHistory(sales, {
          address: resolvedAddress?.address,
          lat,
          lon,
          surface: listing.surface,
        });
        const tl = buildSaleTimeline(history, listing.price);
        if (!cancelled) {
          setMarket(stats);
          setTimeline(tl);
        }
      } catch {
        if (!cancelled) {
          setMarket(null);
          setTimeline(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listing, type, lat, lon, resolvedAddress?.address]);

  return { market, timeline, loading };
}
