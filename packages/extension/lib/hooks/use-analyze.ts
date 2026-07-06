import { useCallback, useState } from "react";
import type { Listing, ResolvedAddress } from "@empir/core";
import { getDeviceHash, invokeEdge } from "@/lib/supabase";

/** Bloc de diagnostic renvoyé par la fonction `analyze` (mode debug). */
export interface AnalyzeDebug {
  /** Entrée exacte passée au résolveur (valeurs extraites de l'annonce). */
  resolverInput?: Record<string, unknown>;
  /** Nombre de certificats ADEME retournés (−1 si servi depuis le cache). */
  ademeTotal?: number;
  /** Certificats conservés après le filtre dur surface ±15% (−1 si cache). */
  keptAfterSurfaceFilter?: number;
  /** La passe 2 cadastre (terrain, maisons) a-t-elle été déclenchée. */
  usedLandSurfacePass?: boolean;
  /** Résultat servi depuis le cache `address_cache` (algo non rejoué). */
  fromCache?: boolean;
}

export interface AnalysisResult {
  status: "ok" | "quota_exceeded";
  resolvedAddress?: ResolvedAddress;
  candidates?: ResolvedAddress[];
  enrichments?: {
    risks?: unknown;
    plu?: unknown;
    taxeFonciere?: unknown;
  };
  /** `limit` null = illimité (compte vérifié). `reason` = "account_required" quand bloqué. */
  usage: { used: number; limit: number | null; allowed: boolean; plan: string; reason?: string };
  debug?: AnalyzeDebug;
}

export interface UseAnalyze {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  run(listing: Listing): Promise<AnalysisResult | null>;
  reset(): void;
}

export function useAnalyze(): UseAnalyze {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (listing: Listing) => {
    setLoading(true);
    setError(null);
    try {
      const deviceHash = await getDeviceHash();
      const data = await invokeEdge<AnalysisResult>("analyze", { deviceHash, listing });
      setResult(data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    result,
    loading,
    error,
    run,
    reset: () => {
      setResult(null);
      setError(null);
    },
  };
}
