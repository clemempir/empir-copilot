import type { Listing } from "@empir/core";

/** Visuels isométriques maison / appartement / immeuble (ResultView, AnalyzingView). */

export type PropertyKind = "house" | "apartment" | "immeuble";

export const PROPERTY_VISUALS: Record<PropertyKind, { src: string; alt: string; label: string }> = {
  house: {
    src: "/property/house.png",
    alt: "Visuel isométrique d'une maison",
    label: "Maison",
  },
  apartment: {
    src: "/property/apartment.png",
    alt: "Visuel isométrique d'un appartement",
    label: "Appartement",
  },
  immeuble: {
    src: "/property/immeuble.png",
    alt: "Visuel isométrique d'un immeuble",
    label: "Immeuble",
  },
};

export function propertyKind(listing: Listing): PropertyKind {
  const title = (listing.title ?? "").toLowerCase();
  if (/immeuble|rapport/.test(title)) return "immeuble";
  if (listing.propertyType === "Maison") return "house";
  return "apartment";
}
