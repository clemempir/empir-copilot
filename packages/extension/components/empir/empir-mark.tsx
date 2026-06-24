import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmpirMarkProps {
  className?: string;
}

/**
 * EmpirMark — "E" blanc sur fond dégradé violet (#7c6cff → #5b4be0).
 * Réutilisable dans la barre du sidepanel, l'header de l'écran de signup,
 * la favicon de la page options, etc.
 */
export function EmpirMark({ className }: EmpirMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("block shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="empir-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c6cff" />
          <stop offset="100%" stopColor="#5b4be0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#empir-mark-grad)" />
      <path
        d="M16 14h17v5.6H22v4.7h9.2v5.4H22v4.9h11.4V40H16z"
        fill="#ffffff"
      />
    </svg>
  );
}
