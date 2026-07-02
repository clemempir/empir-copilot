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
  // Palette et libellés dérivés une seule fois du signe de l'écart.
  const gap =
    (gapPct ?? 0) >= 0
      ? { bg: "bg-empir-danger/15", fg: "text-empir-danger", dim: "text-empir-danger/80", sign: "+", word: "au-dessus" }
      : { bg: "bg-empir-success/15", fg: "text-empir-success", dim: "text-empir-success/80", sign: "−", word: "sous" };

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
              gap.bg,
            )}
          >
            <span className={cn("text-[12px] font-bold tabular-nums", gap.fg)}>
              {gap.sign}
              {Math.abs(Math.round(gapPct!))}%
            </span>
            <span className={cn("text-[9px]", gap.dim)}>{gap.word} le marché</span>
          </span>
        )}
      </div>
      {meta && (
        <div className="mt-2.5 text-[10px] text-empir-muted-2 leading-relaxed">{meta}</div>
      )}
    </div>
  );
}
