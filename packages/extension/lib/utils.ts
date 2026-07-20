import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { stripAccentsLower } from "@empir/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Comparaison d'adresses tolérante (casse, accents, ponctuation, espaces). */
export function sameAddress(a: string, b: string): boolean {
  const norm = (s: string) =>
    stripAccentsLower(s)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return norm(a) === norm(b);
}
