import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const empirButton = cva(
  "inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-[opacity,transform,box-shadow] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-empir-primary/60",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-empir-primary to-empir-primary-dark text-white shadow-empir-glow hover:brightness-110",
        secondary:
          "bg-white/5 text-empir-text border border-empir-line-strong hover:bg-white/10",
        ghost: "bg-transparent text-empir-text hover:bg-white/5",
        danger:
          "bg-empir-danger/90 text-white hover:bg-empir-danger",
      },
      size: {
        sm: "h-8 px-3 text-[12px] rounded-[8px]",
        md: "h-10 px-4 text-[13px] rounded-empir-btn",
        lg: "h-11 px-5 text-[13.5px] rounded-empir-btn",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface EmpirButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof empirButton> {}

export function EmpirButton({
  className,
  variant,
  size,
  ...props
}: EmpirButtonProps) {
  return <button className={cn(empirButton({ variant, size }), className)} {...props} />;
}
