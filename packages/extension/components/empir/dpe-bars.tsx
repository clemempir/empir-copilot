import * as React from "react";
import { cn } from "@/lib/utils";

export type DpeClass = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface DpeBarsProps {
  /** Classe annoncée dans l'annonce. */
  announced?: DpeClass;
  /** Classe réelle issue de l'ADEME (résolveur). */
  verified?: DpeClass;
  /** Légende sous les barres (ex. "~+380 €/an d'énergie vs annonce"). */
  note?: string;
  className?: string;
}

const ALL: DpeClass[] = ["A", "B", "C", "D", "E", "F", "G"];
const HEIGHTS: Record<DpeClass, number> = {
  A: 24,
  B: 32,
  C: 42,
  D: 52,
  E: 62,
  F: 72,
  G: 82,
};
const COLORS: Record<DpeClass, string> = {
  A: "bg-empir-dpe-a",
  B: "bg-empir-dpe-b",
  C: "bg-empir-dpe-c",
  D: "bg-empir-dpe-d",
  E: "bg-empir-dpe-e",
  F: "bg-empir-dpe-f",
  G: "bg-empir-dpe-g",
};

/**
 * Histogramme DPE A-G. Si `announced` et `verified` divergent, les deux sont
 * marqués (annoncé en silhouette grise, vérifié en couleur pleine).
 */
export function DpeBars({ announced, verified, note, className }: DpeBarsProps) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-end gap-1.5">
        {ALL.map((c) => {
          const isAnnounced = c === announced;
          const isVerified = c === verified;
          const active = isVerified || (isAnnounced && !verified);
          return (
            <div key={c} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-all",
                  active ? COLORS[c] : "bg-white/8",
                )}
                style={{ height: `${HEIGHTS[c]}px`, opacity: active ? 1 : 0.5 }}
              >
                <div className="pt-1 text-center text-[10px] font-semibold text-white">{c}</div>
              </div>
              {isAnnounced && verified && verified !== announced && (
                <div className="text-[8.5px] uppercase tracking-[0.12em] text-empir-muted-2">
                  annoncé
                </div>
              )}
              {isVerified && (
                <div className="text-[8.5px] uppercase tracking-[0.12em] text-empir-accent">
                  vérifié
                </div>
              )}
            </div>
          );
        })}
      </div>
      {note && <p className="text-[10.5px] leading-snug text-empir-muted-2">{note}</p>}
    </div>
  );
}
