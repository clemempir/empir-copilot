import * as React from "react";
import { cn } from "@/lib/utils";

export type RiskLevel = "low" | "medium" | "high" | "info";

export interface RiskRowProps {
  label: string;
  level: RiskLevel;
  /** Texte affiché dans la pill (défaut = level). */
  statusLabel?: string;
  className?: string;
}

const STYLES: Record<RiskLevel, { dot: string; pill: string }> = {
  low: { dot: "bg-empir-success", pill: "bg-empir-success/15 text-empir-success" },
  medium: { dot: "bg-empir-warn", pill: "bg-empir-warn/15 text-empir-warn" },
  high: { dot: "bg-empir-danger", pill: "bg-empir-danger/15 text-empir-danger" },
  info: { dot: "bg-empir-accent", pill: "bg-empir-accent/15 text-empir-accent" },
};

const DEFAULT_LABELS: Record<RiskLevel, string> = {
  low: "faible",
  medium: "modéré",
  high: "élevé",
  info: "à vérifier",
};

export function RiskRow({ label, level, statusLabel, className }: RiskRowProps) {
  const { dot, pill } = STYLES[level];
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-empir-line py-2 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("size-2 rounded-full", dot)} />
        <span className="text-[12px] text-empir-text">{label}</span>
      </div>
      <span
        className={cn(
          "rounded-empir-pill px-2 py-[3px] text-[10.5px] font-medium uppercase tracking-[0.08em]",
          pill,
        )}
      >
        {statusLabel ?? DEFAULT_LABELS[level]}
      </span>
    </div>
  );
}
