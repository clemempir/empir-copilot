import { useEffect, useState } from "react";
import type { DpeDetails } from "@empir/core";
import { cachedDpeDetails } from "@/lib/enrichment-cache";

export interface UseDpeDetails {
  details: DpeDetails | null;
  loading: boolean;
}

/**
 * Détail « second œuvre » du DPE réel (chauffage, fenêtres, isolation) à partir
 * du certificat ADEME confirmé par le résolveur. Côté client (le core
 * `fetchDpeDetails` est propre + testé ; data.ademe.fr est en host-permissions).
 * Ne fait rien tant qu'aucun certificat n'est confirmé.
 */
export function useDpeDetails(certId: string | undefined): UseDpeDetails {
  const [details, setDetails] = useState<DpeDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!certId) {
      setDetails(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const info = await cachedDpeDetails(certId);
        if (!cancelled) setDetails(info);
      } catch {
        if (!cancelled) setDetails(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [certId]);

  return { details, loading };
}
