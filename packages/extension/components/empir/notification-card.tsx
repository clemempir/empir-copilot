import * as React from "react";
import { Bell, CheckCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NotificationCardProps {
  title: string;
  body?: string;
  time?: string;
  read?: boolean;
  icon?: LucideIcon;
  /** Tonalité de l'icône. */
  tone?: "primary" | "success" | "warn" | "danger";
  /** Marque la notification comme lue (icône ✓✓ — aussi déclenché au clic d'un lien). */
  onClick?: () => void;
  className?: string;
}

const TONES: Record<NonNullable<NotificationCardProps["tone"]>, string> = {
  primary: "bg-empir-primary/20 text-empir-accent",
  success: "bg-empir-success/15 text-empir-success",
  warn: "bg-empir-warn/15 text-empir-warn",
  danger: "bg-empir-danger/15 text-empir-danger",
};

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Rend les URLs du message cliquables (nouvel onglet). */
export function linkify(text: string, onLinkClick?: () => void): React.ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        onClick={onLinkClick}
        className="break-all text-empir-accent underline decoration-empir-accent/40 underline-offset-2 hover:decoration-empir-accent"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

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
    <div
      className={cn(
        "flex w-full items-start gap-2.5 rounded-empir-card border border-empir-line bg-empir-card px-3 py-2.5 text-left",
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
        <div className="text-[12.5px] font-semibold leading-6 text-empir-text">{title}</div>
        {body && (
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-empir-muted">
            {linkify(body, !read ? onClick : undefined)}
          </p>
        )}
      </div>
      {/* Colonne droite : date de réception + « marquer comme lu », centrés
          verticalement sur la hauteur de la carte. */}
      <div className="flex shrink-0 items-center gap-1.5 self-stretch">
        {time && <span className="text-[10px] text-empir-muted-2">{time}</span>}
        {!read &&
          (onClick ? (
            <button
              type="button"
              onClick={onClick}
              title="Marquer comme lu"
              className="grid size-6 place-items-center rounded-[6px] text-empir-muted-2 transition-colors hover:bg-white/5 hover:text-empir-success"
            >
              <CheckCheck className="size-[13px]" strokeWidth={2} />
            </button>
          ) : (
            <span className="size-1.5 rounded-full bg-empir-primary" aria-hidden />
          ))}
      </div>
    </div>
  );
}
