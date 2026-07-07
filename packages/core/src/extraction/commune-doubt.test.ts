import { describe, expect, it } from "vitest";
import { detectCommuneDoubt } from "./commune-doubt.ts";

// Phrases RÉELLES issues des annonces revues en console le 2026-07-03 —
// l'agent classe l'annonce à Mont-de-Marsan, la description avoue le village.
describe("detectCommuneDoubt — cas réels (verdicts console)", () => {
  it("« sur la commune de VERT » → doute nommé (bi-safti-1-1678476)", () => {
    const d = detectCommuneDoubt(
      "Je vous invite à découvrir cette jolie maison des années 1980 d’environ 70m² située sur la commune de VERT, environ 30 minutes de Mont de Marsan et 5 minutes de Roquefort.",
      "Mont-de-Marsan",
    );
    expect(d).not.toBeNull();
    expect(d!.city).toBe("VERT");
  });

  it("« A Cauna village des landes » → doute nommé (bi-immo-facile-60736754)", () => {
    const d = detectCommuneDoubt(
      "A Cauna village des landes, à 15 mn de Mont de Marsan, un atelier avec une très belle charpente et une grande superficie à rénover offre un potentiel exceptionnel.",
      "Mont-de-Marsan",
    );
    expect(d).not.toBeNull();
    expect(d!.city).toBe("Cauna");
  });

  it("« A seulement 15 mn de Mont de Marsan » → doute distance (bi-immo-facile-60736404)", () => {
    const d = detectCommuneDoubt(
      "A seulement 15 mn de Mont de Marsan, très grande maison de village à réhabiliter, offrant un fort potentiel.",
      "Mont-de-Marsan",
    );
    expect(d).not.toBeNull();
    expect(d!.city).toBeUndefined(); // distance sans commune nommée
  });

  it("« A 20 min au Nord de Mont de Marsan » → doute distance (bi-immo-facile-60844223)", () => {
    const d = detectCommuneDoubt(
      "A 20 min au Nord de Mont de Marsan, située dans un environnement calme et préservé, cette maison de plain-pied d'environ 113 m².",
      "Mont-de-Marsan",
    );
    expect(d).not.toBeNull();
  });

  it("« Située à Brocas (40420) » → doute nommé avec code postal", () => {
    const d = detectCommuneDoubt(
      "Belle maison rénovée. Située à Brocas (40420), au calme.",
      "Mont-de-Marsan",
    );
    expect(d).not.toBeNull();
    expect(d!.city).toBe("Brocas");
    expect(d!.postalCode).toBe("40420");
  });
});

describe("detectCommuneDoubt — anti-faux-positifs", () => {
  it("commune déclarée nommée dans le texte → PAS de doute", () => {
    const d = detectCommuneDoubt(
      "Appartement situé à Mont-de-Marsan, proche de toutes commodités.",
      "Mont-de-Marsan",
    );
    expect(d).toBeNull();
  });

  it("distance vers une AUTRE ville → PAS de doute", () => {
    const d = detectCommuneDoubt(
      "Maison à 30 minutes de Bordeaux et 5 minutes du centre.",
      "Mont-de-Marsan",
    );
    expect(d).toBeNull();
  });

  it("« proche de », « à proximité de » → PAS de doute", () => {
    const d = detectCommuneDoubt(
      "Maison proche de Saint-Sever, à proximité de Hagetmau.",
      "Mont-de-Marsan",
    );
    expect(d).toBeNull();
  });

  it("variantes de graphie (tirets/accents) de la commune déclarée → PAS de doute", () => {
    const d = detectCommuneDoubt("Charmante maison située à Saint Sever.", "Saint-Sever");
    expect(d).toBeNull();
  });

  it("sans description ou sans ville déclarée → null", () => {
    expect(detectCommuneDoubt(undefined, "Mont-de-Marsan")).toBeNull();
    expect(detectCommuneDoubt("texte", undefined)).toBeNull();
  });
});
