import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataRowProps {
  label: string;
  value: React.ReactNode;
  /** Texte secondaire (placé en dessous de la valeur). */
  hint?: string;
  className?: string;
}

/** Ligne clé/valeur réutilisée dans la section "caractéristiques" du mockup. */
export function DataRow({ label, value, hint, className }: DataRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-empir-line py-2.5 last:border-b-0",
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-[0.12em] text-empir-muted-2">{label}</span>
      <div className="text-right">
        <div className="text-[12.5px] font-medium text-empir-text">{value}</div>
        {hint && <div className="mt-0.5 text-[10.5px] text-empir-muted-2">{hint}</div>}
      </div>
    </div>
  );
}
