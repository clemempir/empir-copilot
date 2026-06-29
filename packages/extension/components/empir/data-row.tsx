import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataRowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}

export function DataRow({ label, value, hint, className }: DataRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-empir-line py-[11px] text-[12.5px] last:border-b-0",
        className,
      )}
    >
      <span className="text-empir-muted-2">{label}</span>
      <div className="text-right">
        <div className="font-semibold text-empir-text">{value}</div>
        {hint && <div className="mt-0.5 text-[10.5px] text-empir-muted-2">{hint}</div>}
      </div>
    </div>
  );
}
