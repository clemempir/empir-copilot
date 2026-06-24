import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "active" | "done";

export interface StepProgressProps {
  steps: { label: string; status: StepStatus }[];
  /** Pourcentage global (0-100) — utilisé pour la barre du haut. */
  percent: number;
  className?: string;
}

export function StepProgress({ steps, percent, className }: StepProgressProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative h-1.5 overflow-hidden rounded-empir-pill bg-white/8">
        <div
          className="h-full rounded-empir-pill bg-gradient-to-r from-empir-primary to-empir-accent transition-all duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {steps.map((step, i) => {
          const Icon = step.status === "done" ? Check : Loader2;
          return (
            <li key={`${step.label}-${i}`} className="flex items-center gap-2.5 text-[12px]">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  step.status === "done" && "border-empir-success bg-empir-success/15 text-empir-success",
                  step.status === "active" && "border-empir-primary bg-empir-primary/15 text-empir-accent",
                  step.status === "pending" && "border-empir-line text-empir-muted-2",
                )}
              >
                {step.status === "active" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : step.status === "done" ? (
                  <Icon className="size-3" />
                ) : (
                  <span className="size-1.5 rounded-full bg-empir-muted-2/60" />
                )}
              </span>
              <span
                className={cn(
                  "leading-tight",
                  step.status === "done" && "text-empir-text",
                  step.status === "active" && "text-empir-accent font-medium",
                  step.status === "pending" && "text-empir-muted-2",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
