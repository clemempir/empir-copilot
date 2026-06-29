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

  // ── GES : numérique + fallback lettre ───────────────────────────────────

  it("utilise la lettre GES en fallback quand le chiffre manque", () => {
    const { breakdown, confidence } = scoreCertificate(
      { postalCode: "75003", gesClass: "C" },
      baseCert,
    );
    expect(breakdown.find((b) => b.criterion === "gesClass")?.matched).toBe(true);
    expect(confidence).toBe(100);
  });

  it("préfère le GES numérique à la lettre", () => {
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", gesClass: "C", gesKgCO2M2: 28 },
      baseCert,
    );
    expect(breakdown.some((b) => b.criterion === "gesKgCO2M2")).toBe(true);
    expect(breakdown.some((b) => b.criterion === "gesClass")).toBe(false);
  });

  it("rejette une lettre GES qui ne correspond pas", () => {
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", gesClass: "F" },
      baseCert, // gesClass "C"
    );
    expect(breakdown.find((b) => b.criterion === "gesClass")?.matched).toBe(false);
  });

  // ── Surface du terrain (maisons) ────────────────────────────────────────

  it("score la surface du terrain pour une maison", () => {
    const maisonCert = { ...baseCert, buildingType: "maison", landSurface: 800 };
    const { breakdown, confidence } = scoreCertificate(
      { postalCode: "75003", surface: 88, landSurface: 820, propertyType: "Maison" },
      maisonCert,
    );
    expect(breakdown.find((b) => b.criterion === "landSurface")?.matched).toBe(true); // 800↔820 = 2.4%
    expect(confidence).toBe(100);
  });

  it("ignore la surface du terrain pour un appartement", () => {
    const cert = { ...baseCert, landSurface: 800 };
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", landSurface: 820, propertyType: "Appartement" },
      cert,
    );
    expect(breakdown.some((b) => b.criterion === "landSurface")).toBe(false);
  });

  it("ignore la surface du terrain si la contenance cadastrale est absente", () => {
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", landSurface: 820, propertyType: "Maison" },
      { ...baseCert, buildingType: "maison" }, // pas de landSurface côté certificat
    );
    expect(breakdown.some((b) => b.criterion === "landSurface")).toBe(false);
  });

  it("rejette une surface du terrain hors tolérance (>10 %)", () => {
    const maisonCert = { ...baseCert, buildingType: "maison", landSurface: 300 };
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", landSurface: 820, propertyType: "Maison" },
      maisonCert,
    );
    expect(breakdown.find((b) => b.criterion === "landSurface")?.matched).toBe(false);
  });

  // ── Date du DPE ─────────────────────────────────────────────────────────

  it("score la date du DPE dans la tolérance de 60 jours", () => {
    const cert = { ...baseCert, dpeDate: "2024-03-01" };
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", dpeDate: "2024-03-20" },
      cert,
    );
    expect(breakdown.find((b) => b.criterion === "dpeDate")?.matched).toBe(true);
  });

  it("rejette une date du DPE hors tolérance", () => {
    const cert = { ...baseCert, dpeDate: "2024-03-01" };
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", dpeDate: "2024-09-01" },
      cert,
    );
    expect(breakdown.find((b) => b.criterion === "dpeDate")?.matched).toBe(false);
  });

  it("ignore la date du DPE si elle est illisible (hors totalWeight)", () => {
    const cert = { ...baseCert, dpeDate: "2024-03-01" };
    const { breakdown } = scoreCertificate(
      { postalCode: "75003", dpeDate: "date inconnue" },
      cert,
    );
    expect(breakdown.some((b) => b.criterion === "dpeDate")).toBe(false);
  });

  // ── Annonce ne portant que les lettres (DPE + GES en fallback) ──────────

  it("fait feu de tout bois sur une annonce avec lettres seules", () => {
    const { breakdown, confidence } = scoreCertificate(
      { postalCode: "75003", surface: 88, dpeClass: "C", gesClass: "C" },
      baseCert,
    );
    expect(breakdown.find((b) => b.criterion === "dpeClass")?.matched).toBe(true);
    expect(breakdown.find((b) => b.criterion === "gesClass")?.matched).toBe(true);
    expect(confidence).toBe(100);
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
