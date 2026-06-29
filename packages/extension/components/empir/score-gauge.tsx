import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScoreGaugeProps {
  /** 0-100 ; null => "—". */
  score: number | null;
  /** Diamètre en px (défaut 48 — taille hero du design). */
  size?: number;
  /** Épaisseur du trait (défaut size/6). */
  stroke?: number;
  className?: string;
}

const GRAD_ID = "empir-score-grad";

export function ScoreGauge({ score, size = 48, stroke, className }: ScoreGaugeProps) {
  const s = stroke ?? Math.max(4, Math.round(size / 6));
  const r = (size - s) / 2;
  const c = Math.PI * 2 * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const offset = c * (1 - pct);
  const fontPx = Math.round(size * 0.31);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={GRAD_ID} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c6cff" />
            <stop offset="60%" stopColor="#b7acff" />
            <stop offset="100%" stopColor="#f5c451" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={s}
          fill="none"
        />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={`url(#${GRAD_ID})`}
            strokeWidth={s}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.22,.61,.36,1)" }}
          />
        )}
      </svg>
      <span
        className="absolute font-bold leading-none"
        style={{ fontSize: fontPx, color: "#f3f0ff" }}
      >
        {score == null ? "—" : score}
      </span>
    </div>
  );
}
