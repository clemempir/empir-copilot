import { describe, expect, it } from "vitest";
import type { AdemeCertificate } from "./ademe";
import { rankCertificates, scoreCertificate } from "./scorer";

const baseCert: AdemeCertificate = {
  certId: "X-1",
  address: "18 Rue Béranger 75003 Paris",
  postalCode: "75003",
  city: "Paris",
  surface: 88,
  dpeClass: "C",
  dpeKwhM2: 165,
  gesKgCO2M2: 28,
  gesClass: "C",
  yearBuilt: 1976,
  buildingType: "appartement",
};

describe("scoreCertificate", () => {
  it("retourne 100 % quand tous les critères matchent", () => {
    const { confidence, breakdown } = scoreCertificate(
      {
        postalCode: "75003",
        surface: 88,
        dpeKwhM2: 165,
        gesKgCO2M2: 28,
        yearBuilt: 1976,
        propertyType: "Appartement",
      },
      baseCert,
    );
    expect(confidence).toBe(100);
    expect(breakdown.every((b) => b.matched)).toBe(true);
  });

  it("tolère une variation de surface inférieure à 5 %", () => {
    const { confidence } = scoreCertificate(
      { postalCode: "75003", surface: 90 }, // 88 → 90 = 2.3 %
      baseCert,
    );
    expect(confidence).toBe(100);
  });

  it("rejette les critères hors tolérance", () => {
    const { confidence, breakdown } = scoreCertificate(
      { postalCode: "75003", surface: 110, dpeKwhM2: 250, yearBuilt: 1990 },
      baseCert,
    );
    expect(breakdown.find((b) => b.criterion === "surface")?.matched).toBe(false);
    expect(breakdown.find((b) => b.criterion === "dpeKwhM2")?.matched).toBe(false);
    expect(breakdown.find((b) => b.criterion === "yearBuilt")?.matched).toBe(false);
    expect(confidence).toBeLessThan(50);
  });

  it("utilise la lettre DPE si la valeur numérique n'est pas fournie", () => {
    const { breakdown, confidence } = scoreCertificate(
      { postalCode: "75003", dpeClass: "C" },
      baseCert,
    );
    expect(breakdown.find((b) => b.criterion === "dpeClass")?.matched).toBe(true);
    expect(confidence).toBe(100);
  });

  it("préfère la valeur numérique à la lettre", () => {
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", dpeClass: "C", dpeKwhM2: 165 },
      baseCert,
    );
    expect(breakdown.some((b) => b.criterion === "dpeKwhM2")).toBe(true);
    expect(breakdown.some((b) => b.criterion === "dpeClass")).toBe(false);
  });
});

describe("rankCertificates", () => {
  it("filtre les surfaces très éloignées (> 15 %) et trie par confiance", () => {
    const certs: AdemeCertificate[] = [
      { ...baseCert, certId: "A", surface: 88, dpeKwhM2: 165 }, // match parfait
      { ...baseCert, certId: "B", surface: 200, dpeKwhM2: 165 }, // filtré
      { ...baseCert, certId: "C", surface: 92, dpeKwhM2: 250 }, // surface ok, DPE off
    ];
    const ranked = rankCertificates(
      { postalCode: "75003", surface: 88, dpeKwhM2: 165 },
      certs,
    );
    expect(ranked.map((r) => r.cert.certId)).toEqual(["A", "C"]);
    expect(ranked[0]!.confidence).toBeGreaterThan(ranked[1]!.confidence);
  });

  it("respecte la limite passée en argument", () => {
    const certs: AdemeCertificate[] = Array.from({ length: 10 }, (_, i) => ({
      ...baseCert,
      certId: `c${i}`,
      surface: 88,
    }));
    expect(rankCertificates({ postalCode: "75003", surface: 88 }, certs, 3)).toHaveLength(3);
  });
});
