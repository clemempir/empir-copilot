import { describe, expect, it } from "vitest";
import { extractDpeDate } from "./mapping";

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

  it("aucune date exploitable → undefined", () => {
    // « 1er juillet 2021 » ne matche pas DATE_TOKEN (le « 1er » casse `\d{1,2}\s+`)
    // → le seuil de réforme n'est jamais pris pour une vraie date.
    expect(extractDpeDate("Diagnostic réalisé après le 1er juillet 2021")).toBeUndefined();
    expect(extractDpeDate("appartement lumineux au centre-ville")).toBeUndefined();
  });
});
