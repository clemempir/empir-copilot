import { useEffect, useState } from "react";
import type { RiskItem } from "@empir/core";
import type { RiskLevel } from "@/components/empir/risk-row";
import { cachedCitycode, cachedRisks } from "@/lib/enrichment-cache";

export type { RiskLevel };

export interface RiskRowData {
  label: string;
  level: RiskLevel;
  statusLabel?: string;
}

export interface UseRisks {
  risks: RiskRowData[];
  loading: boolean;
}

/** Déduit un niveau (couleur) depuis le statut Géorisques (« … - modéré »). */
function riskLevel(statut: string): RiskLevel {
  const s = statut.toLowerCase();
  if (/fort|élevé|eleve|important/.test(s)) return "high";
  if (/modéré|modere|moyen/.test(s)) return "medium";
  if (/faible/.test(s)) return "low";
  return "info";
}

/** Libellé court pour la pastille : la gravité si présente, sinon « présent ». */
function riskStatusLabel(statut: string): string {
  const m = statut.match(/(faible|modéré|modere|moyen|fort|élevé|eleve|important)/i);
  return m ? m[1]!.toLowerCase() : "présent";
}

function toRow(item: RiskItem): RiskRowData {
  return { label: item.libelle, level: riskLevel(item.statut), statusLabel: riskStatusLabel(item.statut) };
}

/**
 * Risques Géorisques du bien (naturels puis technologiques) avec leur gravité.
 * Côté client (le core `fetchRisks` est propre + testé ; georisques est autorisé
 * dans host-permissions). Indépendant du type de bien (s'applique aux immeubles).
 * La donnée est communale → un point approximatif (disque) suffit.
 */
export function useRisks(lat: number | undefined, lon: number | undefined): UseRisks {
  const [risks, setRisks] = useState<RiskRowData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lat || !lon) {
      setRisks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const citycode = await cachedCitycode(lat, lon);
        if (!citycode) {
          if (!cancelled) setRisks([]);
          return;
        }
        const report = await cachedRisks(citycode);
        const rows = [...report.naturels.map(toRow), ...report.technologiques.map(toRow)];
        if (!cancelled) setRisks(rows);
      } catch {
        if (!cancelled) setRisks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  return { risks, loading };
}
