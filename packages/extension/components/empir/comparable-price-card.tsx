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
        {showGap && (
          <span
            className={cn(
              "mt-0.5 inline-flex shrink-0 items-baseline gap-[5px] rounded-[8px] px-[9px] py-1",
              gapPositive ? "bg-empir-danger/15" : "bg-empir-success/15",
            )}
          >
            <span
              className={cn(
                "text-[12px] font-bold tabular-nums",
                gapPositive ? "text-empir-danger" : "text-empir-success",
              )}
            >
              {gapPositive ? "+" : "−"}
              {Math.abs(Math.round(gapPct!))}%
            </span>
            <span className={cn("text-[9px]", gapPositive ? "text-empir-danger/80" : "text-empir-success/80")}>
              {gapPositive ? "au-dessus" : "sous"} le marché
            </span>
          </span>
        )}
      </div>
      {meta && (
        <div className="mt-2.5 text-[10px] text-empir-muted-2 leading-relaxed">{meta}</div>
      )}
    </div>
  );
}
