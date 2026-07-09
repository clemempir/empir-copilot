import * as React from "react";
import { cn } from "@/lib/utils";

export interface UrbanismeCardProps {
  /** Zone (ex. "Zone ABF", "Zone UA"). */
  zone: string;
  /** Sous-titre court (ex. "Tissu historique"). */
  subtitle?: string;
  /** Texte explicatif (ex. "Périmètre Bâtiments de France — avis requis"). */
  description?: string;
  /** Variante visuelle. */
  tone?: "default" | "warn" | "info";
  /** Statut patrimonial, exposé en `data-statut` pour un code couleur CSS. */
  statut?: "concerne" | "non-concerne" | "inconnu";
  className?: string;
}

const TONES: Record<NonNullable<UrbanismeCardProps["tone"]>, { accent: string; bg: string }> = {
  default: { accent: "bg-empir-primary", bg: "bg-empir-primary/8" },
  warn: { accent: "bg-empir-warn", bg: "bg-empir-warn/8" },
  info: { accent: "bg-empir-accent", bg: "bg-empir-accent/8" },
};

export function UrbanismeCard({
  zone,
  subtitle,
  description,
  tone = "default",
  statut,
  className,
}: UrbanismeCardProps) {
  const t = TONES[tone];
  return (
    <div
      data-statut={statut}
      className={cn(
        "relative overflow-hidden rounded-empir-card border border-empir-line p-3 pl-4",
        t.bg,
        className,
      )}
    >
      <span className={cn("absolute left-0 top-0 h-full w-1", t.accent)} />
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-empir-text">{zone}</span>
        {subtitle && (
          <span className="text-[11px] text-empir-muted">{subtitle}</span>
        )}
      </div>
      {description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-empir-muted">{description}</p>
      )}
    </div>
  );
}
