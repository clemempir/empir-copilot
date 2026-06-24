import * as React from "react";
import { cn } from "@/lib/utils";
import { EmpirMark } from "./empir-mark";

export type EmpirLogoSize = "sm" | "md" | "lg";

export interface EmpirLogoProps {
  size?: EmpirLogoSize;
  withText?: boolean;
  /** Tagline "BÂTISSEUR D'EMPIRE" — visible sur l'écran de signup, masqué partout ailleurs. */
  withTagline?: boolean;
  href?: string;
  className?: string;
}

const ICON_SIZE: Record<EmpirLogoSize, string> = {
  sm: "size-5",
  md: "size-[22px]",
  lg: "size-9",
};

const TEXT_SIZE: Record<EmpirLogoSize, string> = {
  sm: "text-[13px]",
  md: "text-[15px]",
  lg: "text-lg",
};

export function EmpirLogo({
  size = "md",
  withText = true,
  withTagline = false,
  href,
  className,
}: EmpirLogoProps) {
  const content = (
    <>
      <EmpirMark className={ICON_SIZE[size]} />
      {withText && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-semibold tracking-[-0.02em] text-empir-text",
              TEXT_SIZE[size],
            )}
          >
            EMPIR
          </span>
          {withTagline && (
            <span className="mt-0.5 text-[8px] uppercase tracking-[0.2em] text-empir-muted-2">
              Bâtisseur d'empire
            </span>
          )}
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        aria-label="EMPIR Copilot"
        className={cn("flex cursor-pointer items-center gap-2 no-underline", className)}
      >
        {content}
      </a>
    );
  }

  return <div className={cn("flex items-center gap-2", className)}>{content}</div>;
}
