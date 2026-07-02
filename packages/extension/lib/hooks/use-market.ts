import { useEffect, useRef, useState } from "react";
import {
  buildSaleTimeline,
  computeMarketStats,
  propertySaleHistory,
  type Listing,
  type MarketStats,
  type ResolvedAddress,
  type SaleTimeline,
} from "@empir/core";
import { cachedCitycode, cachedCommuneSales } from "@/lib/enrichment-cache";

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
  const address = resolvedAddress?.address;

  // Le state d'onglet est un objet NEUF à chaque broadcast du background : ne
  // dépendre que des primitives réellement utilisées, sinon l'effet re-télécharge
  // les CSV DVF (plusieurs Mo) à chaque re-synchronisation sans changement réel.
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const url = listing?.url;
  const price = listing?.price;
  const surface = listing?.surface;

  useEffect(() => {
    const cur = listingRef.current;
    // DVF ne couvre que maisons/appartements (pas les immeubles), et il faut un point.
    if (!cur || (type !== "Appartement" && type !== "Maison") || !lat || !lon) {
      setMarket(null);
      setTimeline(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const citycode = await cachedCitycode(lat, lon);
        if (!citycode) {
          if (!cancelled) {
            setMarket(null);
            setTimeline(null);
          }
          return;
        }
        const sales = await cachedCommuneSales(citycode);
        const stats = computeMarketStats(sales, { lat, lon }, type, { surface });
        // Historique du bien : ventes passées à cette adresse + prix affiché aujourd'hui.
        const history = propertySaleHistory(sales, { address, lat, lon, surface });
        const tl = buildSaleTimeline(history, cur.price);
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
  }, [url, price, surface, type, lat, lon, address]);

  return { market, timeline, loading };
}
