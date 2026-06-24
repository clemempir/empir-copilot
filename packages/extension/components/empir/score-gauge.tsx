import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScoreGaugeProps {
  /** 0-100 ; null => "—". */
  score: number | null;
  /** Diamètre en px (défaut 96). */
  size?: number;
  /** Épaisseur du trait (défaut 8). */
  stroke?: number;
  /** Libellé sous le score (défaut "/100"). */
  unit?: string;
  className?: string;
}

function colorForScore(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#7c6cff";
  if (score >= 40) return "#f5c451";
  return "#ef6b6b";
}

/**
 * Jauge circulaire SVG façon EMPIR — trait dégradé violet, animation
 * stroke-dashoffset (reproduit `scoreDraw` du mockup) et numéro central
 * en Roboto Flex.
 */
export function ScoreGauge({
  score,
  size = 96,
  stroke = 8,
  unit = "/100",
  className,
}: ScoreGaugeProps) {
  const r = (size - stroke) / 2;
  const c = Math.PI * 2 * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const offset = c * (1 - pct);
  const color = score == null ? "#3c4250" : colorForScore(score);

  return (
    <div
      className={cn("relative inline-flex flex-col items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.22,.61,.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[28px] font-semibold tabular-nums text-empir-text">
          {score == null ? "—" : score}
        </span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-empir-muted-2">
          {unit}
        </span>
      </div>
    </div>
  );
}
