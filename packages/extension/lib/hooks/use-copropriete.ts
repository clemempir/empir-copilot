import { useEffect, useState } from "react";
import type { CoproprieteInfo } from "@empir/core";
import { cachedCopropriete } from "@/lib/enrichment-cache";

export interface UseCopropriete {
  copro: CoproprieteInfo | null;
  loading: boolean;
}

/**
 * Clés d'interrogation du registre : une `ResolvedAddress` convient telle
 * quelle, mais une adresse affirmée par l'utilisateur + la parcelle levée au
 * point (mode manuel) suffit aussi.
 */
export interface CoproKey {
  parcelId?: string;
  parcelSection?: string;
  parcelNumero?: string;
  address?: string;
  lat?: number;
  lon?: number;
}

/**
 * Statut de copropriété du bien (registre national RNIC), à partir de la
 * parcelle résolue. Côté client (le core `fetchCopropriete` est propre + testé ;
 * l'API tabulaire data.gouv est publique). Ne fait rien tant que la parcelle
 * (`parcelId`) n'est pas connue — sans elle, aucune clé pour interroger le registre.
 */
export function useCopropriete(resolved: CoproKey | undefined): UseCopropriete {
  const [copro, setCopro] = useState<CoproprieteInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const parcelId = resolved?.parcelId;
  const section = resolved?.parcelSection;
  const numero = resolved?.parcelNumero;
  const address = resolved?.address;
  const lat = resolved?.lat;
  const lon = resolved?.lon;

  useEffect(() => {
    // Il faut au moins une clé : la parcelle (match IDU/géo) ou l'adresse (match
    // n° + rue + code postal, qui rattrape une parcelle imprécise type Le Bon Coin).
    if (!parcelId && !address) {
      setCopro(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const info = await cachedCopropriete({
          id: parcelId ?? "",
          section: section ?? "",
          numero: numero ?? "",
          address,
          lat,
          lon,
        });
        if (!cancelled) setCopro(info);
      } catch {
        if (!cancelled) setCopro(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parcelId, section, numero, address, lat, lon]);

  return { copro, loading };
}
