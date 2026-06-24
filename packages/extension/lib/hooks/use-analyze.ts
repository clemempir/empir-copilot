import { useCallback, useState } from "react";
import type { Listing, ResolvedAddress } from "@empir/core";
import { getDeviceHash, invokeEdge } from "@/lib/supabase";

export interface AnalysisResult {
  status: "ok" | "quota_exceeded";
  resolvedAddress?: ResolvedAddress;
  candidates?: ResolvedAddress[];
  enrichments?: {
    risks?: unknown;
    plu?: unknown;
    taxeFonciere?: unknown;
  };
  usage: { used: number; limit: number; allowed: boolean; plan: string };
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
