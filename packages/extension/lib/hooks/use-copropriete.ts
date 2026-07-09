import { useEffect, useState } from "react";
import type { CoproprieteInfo, ResolvedAddress } from "@empir/core";
import { cachedCopropriete } from "@/lib/enrichment-cache";

export interface UseCopropriete {
  copro: CoproprieteInfo | null;
  loading: boolean;
}

/**
 * Statut de copropriété du bien (registre national RNIC), à partir de la
 * parcelle résolue. Côté client (le core `fetchCopropriete` est propre + testé ;
 * l'API tabulaire data.gouv est publique). Ne fait rien tant que la parcelle
 * (`parcelId`) n'est pas connue — sans elle, aucune clé pour interroger le registre.
 */
export function useCopropriete(resolved: ResolvedAddress | undefined): UseCopropriete {
  const [copro, setCopro] = useState<CoproprieteInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const parcelId = resolved?.parcelId;
  const section = resolved?.parcelSection;
  const numero = resolved?.parcelNumero;
  const lat = resolved?.lat;
  const lon = resolved?.lon;

  useEffect(() => {
    // L'IDU seul suffit au match direct (cas courant). Section/numéro ne servent
    // qu'au repli géographique (Paris/Lyon/Marseille) — facultatifs ici.
    if (!parcelId) {
      setCopro(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const info = await cachedCopropriete({
          id: parcelId,
          section: section ?? "",
          numero: numero ?? "",
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
  }, [parcelId, section, numero, lat, lon]);

  return { copro, loading };
}
