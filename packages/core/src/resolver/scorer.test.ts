import { describe, expect, it } from "vitest";
import type { AdemeCertificate } from "./ademe";
import { computeSelectivities, scoreCertificate } from "./scorer";

function cert(p: Partial<AdemeCertificate>): AdemeCertificate {
  return {
    certId: "x",
    address: "adresse",
    postalCode: "40500",
    city: "Saint-Sever",
    surface: 50,
    ...p,
  };
}

describe("computeSelectivities", () => {
  it("sélectivité ~0 pour une valeur partagée par tout le vivier", () => {
    const pool = [cert({ surface: 50 }), cert({ surface: 50 }), cert({ surface: 50 })];
    const sels = computeSelectivities({ postalCode: "40500", surface: 50 }, pool);
    expect(sels.get("surface")!).toBeCloseTo(0, 5); // -ln(4/4) = 0
  });

  it("forte sélectivité pour une valeur rare (date de DPE)", () => {
    const pool = [
      cert({ dpeDate: "2023-10-25" }),
      ...Array.from({ length: 9 }, () => cert({ dpeDate: "2020-01-01" })),
    ];
    const sels = computeSelectivities({ postalCode: "40500", dpeDate: "2023-10-25" }, pool);
    expect(sels.get("dpeDate")!).toBeGreaterThan(1.5); // -ln(2/11) ≈ 1.7
  });
});

describe("scoreCertificate", () => {
  it("contribution = w·sim·selectivity ; un critère manquant est ignoré (pas de pénalité)", () => {
    const pool = [cert({ surface: 50, dpeKwhM2: 285 }), cert({ surface: 120, dpeKwhM2: 100 })];
    const input = { postalCode: "40500", surface: 50, dpeKwhM2: 285 };
    const sels = computeSelectivities(input, pool);
    const s = scoreCertificate(input, pool[0]!, sels);
    const surf = s.breakdown.find((b) => b.criterion === "surface")!;
    expect(surf.similarity).toBe(1);
    expect(surf.contribution).toBeCloseTo(0.85 * 1 * sels.get("surface")!, 3);
    expect(s.score).toBeGreaterThan(0);
  });

  it("surface qui diverge → contribution 0, mais le certificat n'est pas pénalisé", () => {
    const pool = [cert({ surface: 284, dpeKwhM2: 285 }), cert({ surface: 50, dpeKwhM2: 999 })];
    const input = { postalCode: "40500", surface: 57, dpeKwhM2: 285 };
    const sels = computeSelectivities(input, pool);
    const s = scoreCertificate(input, pool[0]!, sels);
    const surf = s.breakdown.find((b) => b.criterion === "surface")!;
    expect(surf.similarity).toBe(0); // 284 vs 57 hors tolérance max
    expect(s.score).toBeGreaterThan(0); // porté par le DPE numérique
  });

  it("date concordante via le fallback date_visite_diagnostiqueur", () => {
    const c = cert({ dpeDate: "2026-05-14", dpeVisitDate: "2026-05-12" });
    const input = { postalCode: "40500", dpeDate: "2026-05-12" };
    const sels = computeSelectivities(input, [c, cert({ dpeDate: "2000-01-01" })]);
    const s = scoreCertificate(input, c, sels);
    expect(s.breakdown.find((b) => b.criterion === "dpeDate")!.similarity).toBe(1);
  });

  it("DPE numérique exclut la lettre (exclusivité)", () => {
    const c = cert({ dpeKwhM2: 285, dpeClass: "E" });
    const input = { postalCode: "40500", dpeKwhM2: 285, dpeClass: "E" as const };
    const sels = computeSelectivities(input, [c]);
    const s = scoreCertificate(input, c, sels);
    expect(s.breakdown.some((b) => b.criterion === "dpeKwhM2")).toBe(true);
    expect(s.breakdown.some((b) => b.criterion === "dpeClass")).toBe(false);
  });
});
