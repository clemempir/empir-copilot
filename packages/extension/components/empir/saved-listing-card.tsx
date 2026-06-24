import * as React from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SavedListingCardProps {
  title: string;
  meta?: string;
  price?: number;
  score?: number | null;
  photoUrl?: string;
  onClick?: () => void;
  className?: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-empir-success";
  if (score >= 60) return "bg-empir-primary";
  if (score >= 40) return "bg-empir-warn";
  return "bg-empir-danger";
}

const fmtEur = (n: number) => `${n.toLocaleString("fr-FR")} €`;

export function SavedListingCard({
  title,
  meta,
  price,
  score,
  photoUrl,
  onClick,
  className,
}: SavedListingCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-empir-card border border-empir-line bg-empir-card p-2.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-empir-primary/60",
        className,
      )}
    >
      <div className="relative size-[42px] shrink-0 overflow-hidden rounded-[9px] bg-gradient-to-br from-empir-primary/30 to-empir-primary-dark/40">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <Home className="absolute inset-0 m-auto size-5 text-white/70" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-empir-text">{title}</div>
        {meta && <div className="mt-0.5 truncate text-[10.5px] text-empir-muted-2">{meta}</div>}
      </div>
      <div className="text-right">
        {price != null && (
          <div className="text-[12px] font-semibold tabular-nums text-empir-text">{fmtEur(price)}</div>
        )}
        {score != null && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-empir-muted">
            <span className={cn("size-1.5 rounded-full", scoreColor(score))} />
            score {score}
          </div>
        )}
      </div>
    </button>
  );
}
