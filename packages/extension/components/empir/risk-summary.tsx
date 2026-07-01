import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RiskRow, type RiskLevel } from "./risk-row";

export interface RiskSummaryItem {
  label: string;
  level: RiskLevel;
  statusLabel?: string;
}

export interface RiskSummaryProps {
  risks: RiskSummaryItem[];
  className?: string;
}

const SEVERITY_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2, info: 3 };

/**
 * Résumé compact des risques : met en avant les risques élevés (voire le plus
 * sévère), le détail complet se déplie dans un dropdown. Évite une longue liste.
 */
export function RiskSummary({ risks, className }: RiskSummaryProps) {
  const [open, setOpen] = React.useState(false);
  if (risks.length === 0) return null;

  const sorted = [...risks].sort((a, b) => SEVERITY_ORDER[a.level] - SEVERITY_ORDER[b.level]);
  const high = sorted.filter((r) => r.level === "high");
  // Risques mis en avant hors dépliage : les élevés, sinon le plus sévère.
  const featured = high.length > 0 ? high : sorted.slice(0, 1);
  const plural = (n: number) => (n > 1 ? "s" : "");

  return (
    <div
      className={cn("overflow-hidden rounded-empir-card border border-empir-line bg-empir-card", className)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-baseline gap-1.5">
          {high.length > 0 ? (
            <span className="text-[12px] font-semibold text-empir-danger">
              {high.length} risque{plural(high.length)} élevé{plural(high.length)}
            </span>
          ) : (
            <span className="text-[12px] text-empir-text">Aucun risque élevé</span>
          )}
          <span className="truncate text-[10.5px] text-empir-muted-2">
            · {risks.length} recensé{plural(risks.length)}
          </span>
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-empir-muted transition-transform", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </button>

      {/* Mis en avant quand replié */}
      {!open && (
        <div className="px-3.5 pb-1.5">
          {featured.map((r) => (
            <RiskRow key={r.label} {...r} />
          ))}
        </div>
      )}

      {/* Détail complet dans le dropdown */}
      {open && (
        <div className="border-t border-empir-line px-3.5 pb-1.5 pt-0.5">
          {sorted.map((r) => (
            <RiskRow key={r.label} {...r} />
          ))}
        </div>
      )}
    </div>
  );
}
