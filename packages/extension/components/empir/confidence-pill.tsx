import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfidencePillProps {
  /** 0-100. */
  value: number;
  className?: string;
}

/**
 * Pilule "98% fiabilité localisation" — vert dégradé pour >=80, jaune sinon,
 * rouge en-dessous de 50 (cf. mockup, dépasse l'apparente uniformité quand
 * la résolution est ambiguë).
 */
export function ConfidencePill({ value, className }: ConfidencePillProps) {
  const cls =
    value >= 80
      ? "bg-empir-success/15 text-empir-success border-empir-success/30"
      : value >= 50
        ? "bg-empir-warn/15 text-empir-warn border-empir-warn/30"
        : "bg-empir-danger/15 text-empir-danger border-empir-danger/30";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-empir-pill border px-2.5 py-[3px] text-[10.5px] font-medium",
        cls,
        className,
      )}
    >
      <ShieldCheck className="size-3" />
      {value}% fiabilité localisation
    </span>
  );
}
