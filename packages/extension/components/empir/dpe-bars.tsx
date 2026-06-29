import * as React from "react";
import { cn } from "@/lib/utils";

export type DpeClass = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface DpeBarsProps {
  announced?: DpeClass;
  verified?: DpeClass;
  /** Légende sous les barres. */
  note?: string;
  className?: string;
}

const ALL: DpeClass[] = ["A", "B", "C", "D", "E", "F", "G"];
const HEIGHTS: Record<DpeClass, number> = {
  A: 18,
  B: 24,
  C: 30,
  D: 36,
  E: 42,
  F: 48,
  G: 54,
};
const BG: Record<DpeClass, string> = {
  A: "#1f9d55",
  B: "#5cb85c",
  C: "#a9d04b",
  D: "#f5d046",
  E: "#f0a93b",
  F: "#e8702e",
  G: "#d63b2f",
};

export function DpeBars({ announced, verified, note, className }: DpeBarsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {(announced || verified) && (
        <div className="flex items-center justify-between text-[12px] text-empir-muted-2">
          <span>
            Annoncé{" "}
            <span className="font-bold text-empir-success">{announced ?? "—"}</span>
          </span>
          <span>
            Vérifié réel{" "}
            <span className="font-bold text-empir-warn-soft">{verified ?? "—"}</span>
          </span>
        </div>
      )}
      <div className="flex items-end gap-1">
        {ALL.map((c) => {
          const isVerified = c === verified;
          const isAnnounced = c === announced;
          const active = isVerified || isAnnounced;
          const mark = isVerified ? "▼" : isAnnounced ? "·" : "";
          const markColor = isVerified
            ? "var(--color-empir-warn-soft)"
            : isAnnounced
              ? "var(--color-empir-success)"
              : "transparent";
          return (
            <div key={c} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className="h-[11px] text-[9px] leading-none"
                style={{ color: markColor }}
              >
                {mark}
              </span>
              <div
                className="grid w-full place-items-center rounded-[3px]"
                style={{
                  height: HEIGHTS[c],
                  backgroundColor: BG[c],
                  opacity: active ? 1 : 0.32,
                }}
              >
                <span className="text-[10px] font-bold text-[#0b0f17]">{c}</span>
              </div>
            </div>
          );
        })}
      </div>
      {note && (
        <p className="text-[11px] leading-snug text-empir-muted-2">{note}</p>
      )}
    </div>
  );
}
