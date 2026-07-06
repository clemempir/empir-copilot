import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { Comparable } from "@empir/core";
import { cn } from "@/lib/utils";

export interface ComparablePriceCardProps {
  /** Prix médian comparable, en €/m². */
  medianPpm2: number;
  /** Écart % (négatif = sous le marché). */
  gapPct?: number | null;
  /** Métadonnées en bas — ex. "37 ventes · rayon 500 m · 18 derniers mois · P25-P75". */
  meta?: string;
  /** Ventes DVF derrière la médiane — rend la ligne meta dépliable en tableau. */
  comparables?: Comparable[];
  className?: string;
}

const fmtEur = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
/** "2024-03-15" → "03/2024" */
const fmtDate = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : iso;
};
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`);

export function ComparablePriceCard({
  medianPpm2,
  gapPct,
  meta,
  comparables,
  className,
}: ComparablePriceCardProps) {
  const [open, setOpen] = React.useState(false);
  const showGap = gapPct != null;
  // Palette et libellés dérivés une seule fois du signe de l'écart.
  const gap =
    (gapPct ?? 0) >= 0
      ? { bg: "bg-empir-danger/15", fg: "text-empir-danger", dim: "text-empir-danger/80", sign: "+", word: "au-dessus" }
      : { bg: "bg-empir-success/15", fg: "text-empir-success", dim: "text-empir-success/80", sign: "−", word: "sous" };

  // Les ventes « similaires » (type + surface proches de l'annonce) d'abord,
  // puis par proximité — ce sont elles qui portent la médiane.
  const sales = React.useMemo(() => {
    if (!comparables?.length) return [];
    return [...comparables].sort(
      (a, b) => Number(b.similar ?? false) - Number(a.similar ?? false) || a.distanceM - b.distanceM,
    );
  }, [comparables]);
  const expandable = sales.length > 0;

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
      {meta &&
        (expandable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2.5 flex w-full items-center gap-1 text-left text-[10px] leading-relaxed text-empir-muted-2 transition-colors hover:text-empir-muted"
            title={open ? "Masquer le détail des ventes" : "Voir le détail des ventes"}
          >
            <span className="min-w-0 flex-1">{meta}</span>
            <ChevronDown
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
              strokeWidth={2}
            />
          </button>
        ) : (
          <div className="mt-2.5 text-[10px] leading-relaxed text-empir-muted-2">{meta}</div>
        ))}
      {open && expandable && (
        <div className="mt-2 border-t border-empir-line">
          <div className="max-h-[230px] overflow-y-auto">
            {sales.map((c) => (
              <div
                key={`${c.idMutation}-${c.lat}-${c.lon}-${c.surface}`}
                className="border-b border-empir-line/60 py-[6px] last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-empir-muted">
                    {c.similar && (
                      <span
                        className="mr-1 inline-block size-[5px] rounded-full bg-empir-accent align-middle"
                        title="Vente similaire (type et surface proches)"
                      />
                    )}
                    {c.address || "Adresse non précisée"}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-empir-text">
                    {fmtEur(c.price)} €
                  </span>
                </div>
                <div className="mt-[1px] flex items-baseline justify-between gap-2 text-[9.5px] text-empir-muted-2">
                  <span>
                    {fmtDate(c.date)} · {Math.round(c.surface)} m²
                    {c.rooms ? ` · ${c.rooms} p.` : ""} · à {fmtDist(c.distanceM)}
                  </span>
                  <span className="shrink-0 tabular-nums">{fmtEur(c.pricePerM2)} €/m²</span>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-[6px] text-[9px] text-empir-muted-2">
            <span className="mr-1 inline-block size-[5px] rounded-full bg-empir-accent align-middle" />
            ventes similaires au bien (type et surface proches)
          </div>
        </div>
      )}
    </div>
  );
}
