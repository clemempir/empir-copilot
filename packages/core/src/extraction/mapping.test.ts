import { describe, expect, it } from "vitest";
import { extractDpeDate, extractGesKgM2, fixMojibake } from "./mapping.ts";

describe("extractDpeDate — formulations réelles", () => {
  it("Bien'ici : « Date de réalisation du DPE : 21 avril 2026 » (ignore le piège « 1er juillet 2021 »)", () => {
    // Cas réel Bien'ici : la vraie date suit « DPE », le « 1er juillet 2021 » est
    // le seuil de réforme (« Diagnostic réalisé après le 1er juillet 2021 »).
    const txt =
      "Date de réalisation du DPE : 21 avril 2026. Diagnostic réalisé après le 1er juillet 2021 (afficher le schéma complet).";
    expect(extractDpeDate(txt)).toBe("2026-04-21");
  });

  it("formats numériques et ISO près du mot DPE", () => {
    expect(extractDpeDate("DPE établi le 05/12/2024")).toBe("2024-12-05");
    expect(extractDpeDate("diagnostic réalisé le 2023-06-28")).toBe("2023-06-28");
  });

  it("Leboncoin : « Date de réalisation du diagnostic énergétique : 26/11/2025 » (cas réel 3087571354)", () => {
    expect(
      extractDpeDate("Date de réalisation du diagnostic énergétique : 26/11/2025"),
    ).toBe("2025-11-26");
  });

  it("aucune date exploitable → undefined", () => {
    // « 1er juillet 2021 » ne matche pas DATE_TOKEN (le « 1er » casse `\d{1,2}\s+`)
    // → le seuil de réforme n'est jamais pris pour une vraie date.
    expect(extractDpeDate("Diagnostic réalisé après le 1er juillet 2021")).toBeUndefined();
    expect(extractDpeDate("appartement lumineux au centre-ville")).toBeUndefined();
  });
});

describe("extractGesKgM2 — formulations réelles", () => {
  it("Leboncoin : « 58 CO2/m²/an » sans « kg » (cas réel 3195763796)", () => {
    expect(extractGesKgM2("Emission de gaz à effet de serre : 58 CO2/m²/an")).toBe(58);
  });

  it("formulations avec unité complète", () => {
    expect(extractGesKgM2("GES : 12 kg CO2/m²/an")).toBe(12);
    expect(extractGesKgM2("7,9 kgeqCO2/m².an")).toBe(7.9);
    expect(extractGesKgM2("44 kg eq. CO₂/m²/an")).toBe(44);
  });

  it("pas de valeur GES → undefined", () => {
    expect(extractGesKgM2("réduction des émissions de CO2 du bâtiment")).toBeUndefined();
    expect(extractGesKgM2("Classe GES : E")).toBeUndefined();
  });
});

describe("fixMojibake — adresses ADEME double-encodées (cas réels)", () => {
  it("répare les séquences complètes UTF-8 relues en Windows-1252", () => {
    expect(fixMojibake("4 Avenue de lâ€™Armagnac 40000 Mont-de-Marsan")).toBe(
      "4 Avenue de l'Armagnac 40000 Mont-de-Marsan",
    );
    expect(fixMojibake("4 Rue de Saint-Jean-dâ€™AoÃ»t 40000 Mont-de-Marsan")).toBe(
      "4 Rue de Saint-Jean-d'Août 40000 Mont-de-Marsan",
    );
  });

  it("répare les séquences tronquées (octet final perdu)", () => {
    expect(fixMojibake("2 Avenue Barbe dâ€ Or 40000 Mont-de-Marsan")).toBe(
      "2 Avenue Barbe d'Or 40000 Mont-de-Marsan",
    );
    // Double apostrophe mojibake → une seule
    expect(fixMojibake("2 Impasse dâ€™â€™Artagnan 40000 Mont-de-Marsan")).toBe(
      "2 Impasse d'Artagnan 40000 Mont-de-Marsan",
    );
  });

  it("ne touche pas aux chaînes saines (accents et majuscules accentuées)", () => {
    expect(fixMojibake("22 Rue du Château d'Eau 40000 Mont-de-Marsan")).toBe(
      "22 Rue du Château d'Eau 40000 Mont-de-Marsan",
    );
    expect(fixMojibake("211 Avenue du Maréchal Foch")).toBe("211 Avenue du Maréchal Foch");
    expect(fixMojibake("RUE DU CHÂTEAU")).toBe("RUE DU CHÂTEAU");
  });
});
