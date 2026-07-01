import * as React from "react";
import { cn } from "@/lib/utils";

export interface SaleNode {
  year: number;
  price: number;
  /** Couleur du dot (sinon dégradé par défaut). */
  color?: string;
}

export interface SalesTimelineProps {
  nodes: SaleNode[];
  className?: string;
}

const fmtEur = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} M€`
    : `${Math.round(n / 1000)} k€`;

/**
 * Timeline horizontale des ventes DVF historiques pour le bien (cf. mockup).
 * Si moins de 2 ventes, n'affiche rien (placeholder géré par le parent).
 */
export function SalesTimeline({ nodes, className }: SalesTimelineProps) {
  if (nodes.length < 2) return null;
  const sorted = [...nodes].sort((a, b) => a.year - b.year);
  return (
    <div className={cn("relative flex items-stretch gap-1", className)}>
      {/* Ligne de fond — passe par le centre des points (dot 12px → centre à 6px) */}
      <div className="absolute left-3 right-3 top-[5px] h-px bg-gradient-to-r from-empir-primary/30 via-empir-accent/40 to-empir-primary/30" />
      {sorted.map((n, idx) => (
        <div key={`${n.year}-${idx}`} className="relative flex flex-1 flex-col items-center">
          <span
            className="z-10 size-3 rounded-full border-2 border-empir-bg ring-2"
            style={{
              backgroundColor: n.color ?? "#7c6cff",
              boxShadow: `0 0 0 4px rgba(124,108,255,0.18)`,
              ["--tw-ring-color" as unknown as string]: "transparent",
            }}
          />
          <div className="mt-2 text-center leading-tight">
            <div className="text-[11.5px] font-semibold text-empir-text">{n.year}</div>
            <div className="text-[10.5px] tabular-nums text-empir-muted">{fmtEur(n.price)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
