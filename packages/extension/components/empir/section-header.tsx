import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  label: string;
  className?: string;
}

export function SectionHeader({ label, className }: SectionHeaderProps) {
  return (
    <div className={cn("mt-6 mb-3 flex items-center gap-2.5", className)}>
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-empir-muted-2">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/7" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
    </div>
  );
}
