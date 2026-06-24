import * as React from "react";
import { Bell, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NotificationCardProps {
  title: string;
  body?: string;
  time?: string;
  read?: boolean;
  icon?: LucideIcon;
  /** Tonalité de l'icône. */
  tone?: "primary" | "success" | "warn" | "danger";
  onClick?: () => void;
  className?: string;
}

const TONES: Record<NonNullable<NotificationCardProps["tone"]>, string> = {
  primary: "bg-empir-primary/20 text-empir-accent",
  success: "bg-empir-success/15 text-empir-success",
  warn: "bg-empir-warn/15 text-empir-warn",
  danger: "bg-empir-danger/15 text-empir-danger",
};

export function NotificationCard({
  title,
  body,
  time,
  read = false,
  icon: Icon = Bell,
  tone = "primary",
  onClick,
  className,
}: NotificationCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-empir-card border border-empir-line bg-empir-card px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-empir-primary/60",
        !read && "border-empir-primary/30",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-[30px] shrink-0 items-center justify-center rounded-empir-icon",
          TONES[tone],
        )}
      >
        <Icon className="size-[15px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-semibold text-empir-text">{title}</span>
          {time && <span className="text-[10px] text-empir-muted-2">{time}</span>}
        </div>
        {body && <p className="mt-0.5 text-[11px] leading-snug text-empir-muted">{body}</p>}
      </div>
      {!read && (
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-empir-primary" aria-hidden />
      )}
    </button>
  );
}
