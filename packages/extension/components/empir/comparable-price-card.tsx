import * as React from "react";
import { cn } from "@/lib/utils";

export interface ComparablePriceCardProps {
  /** Prix médian comparable, en €/m². */
  medianPpm2: number;
  /** Écart % (négatif = sous le marché). */
  gapPct?: number | null;
  /** Métadonnées en bas — ex. "37 ventes · rayon 500 m · 18 derniers mois · P25-P75". */
  meta?: string;
  className?: string;
}

const fmtEur = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export function ComparablePriceCard({
  medianPpm2,
  gapPct,
  meta,
  className,
}: ComparablePriceCardProps) {
  const showGap = gapPct != null;
  const gapPositive = (gapPct ?? 0) >= 0;
  const gapColor = gapPositive
    ? "bg-empir-danger/15 text-empir-danger"
    : "bg-empir-success/15 text-empir-success";
  const gapLabel = showGap
    ? `${gapPositive ? "+" : "−"}${Math.abs(Math.round(gapPct!))}% ${
        gapPositive ? "au-dessus" : "sous"
      } le marché`
    : null;

  return (
    <div
      className={cn(
        "rounded-empir-card border border-empir-line bg-empir-card p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
            Prix médian comparable
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[20px] font-semibold tabular-nums text-empir-text">
              {fmtEur(medianPpm2)}
            </span>
            <span className="text-[11px] text-empir-muted-2">€/m²</span>
          </div>
        </div>
        {gapLabel && (
          <span
            className={cn(
              "self-start rounded-empir-pill px-2.5 py-1 text-[10.5px] font-medium",
              gapColor,
            )}
          >
            {gapLabel}
          </span>
        )}
      </div>
      {meta && (
        <div className="mt-2.5 text-[10px] text-empir-muted-2 leading-relaxed">{meta}</div>
      )}
    </div>
  );
}
