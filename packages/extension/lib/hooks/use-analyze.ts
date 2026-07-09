import { useCallback, useState } from "react";
import { browser } from "wxt/browser";
import type { Listing, ResolvedAddress } from "@empir/core";
import { getDeviceHash, invokeEdge } from "@/lib/supabase";

/**
 * Dernière analyse réussie, persistée en session storage : le sidepanel est
 * DÉCHARGÉ par Chrome quand on change d'onglet (panneau scoped par onglet) —
 * sans cette mémoire, un aller-retour vers Google Maps effaçait le résultat.
 */
const LAST_ANALYSIS_KEY = "empir:last-analysis";

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
    plu?: unknown;
    taxeFonciere?: unknown;
    patrimoine?: unknown;
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
  /** Recharge le résultat mémorisé pour cette annonce (retour d'onglet). */
  restore(listingUrl: string): Promise<boolean>;
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
      if (data.status === "ok") {
        void browser.storage.session
          .set({ [LAST_ANALYSIS_KEY]: { url: listing.url, result: data } })
          .catch(() => {});
      }
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback(async (listingUrl: string) => {
    const stored = await browser.storage.session
      .get(LAST_ANALYSIS_KEY)
      .catch(() => ({}) as Record<string, unknown>);
    const entry = (stored as Record<string, unknown>)[LAST_ANALYSIS_KEY] as
      | { url: string; result: AnalysisResult }
      | undefined;
    if (entry?.url !== listingUrl || entry.result.status !== "ok") return false;
    setResult(entry.result);
    return true;
  }, []);

  return {
    result,
    loading,
    error,
    run,
    restore,
    reset: () => {
      setResult(null);
      setError(null);
    },
  };
}
