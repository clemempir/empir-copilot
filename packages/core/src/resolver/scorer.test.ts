import { describe, expect, it } from "vitest";
import type { AdemeCertificate } from "./ademe.ts";
import { computeSelectivities, scoreCertificate } from "./scorer.ts";
import type { ResolverInput } from "./types.ts";

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

/** Recalcule le score « à la main » depuis le breakdown (hors ligne _geo). */
function recompute(breakdown: { criterion: string; contribution?: number }[]): number {
  return breakdown
    .filter((b) => b.criterion !== "_geo")
    .reduce((acc, b) => acc + (b.contribution ?? 0), 0);
}

describe("computeSelectivities (par combo)", () => {
  it("sélectivité ~0 pour un combo partagé par tout le vivier", () => {
    const pool = [cert({ surface: 50 }), cert({ surface: 50 }), cert({ surface: 50 })];
    // Pas d'attribut fort → épine = surface×type ; ici type absent → épine = surface.
    const sels = computeSelectivities({ postalCode: "40500", surface: 50 }, pool);
    expect(sels.get("épine")!).toBeCloseTo(0, 5); // -ln(4/4) = 0
  });

  it("forte sélectivité pour une épine rare (date unique)", () => {
    const pool = [
      cert({ dpeDate: "2023-10-25" }),
      ...Array.from({ length: 9 }, () => cert({ dpeDate: "2020-01-01" })),
    ];
    const sels = computeSelectivities({ postalCode: "40500", dpeDate: "2023-10-25" }, pool);
    expect(sels.get("épine")!).toBeGreaterThan(1.5); // -ln(2/11) ≈ 1.7
  });
});

describe("scoreCertificate (croisements multiplicatifs)", () => {
  it("reproductibilité : Σ contributions du breakdown == score renvoyé", () => {
    const input: ResolverInput = {
      postalCode: "40500",
      surface: 50,
      dpeKwhM2: 285,
      dpeDate: "2023-10-25",
      propertyType: "Maison",
    };
    const pool = [
      cert({ surface: 50, dpeKwhM2: 285, dpeDate: "2023-10-25", buildingType: "maison" }),
      cert({ surface: 120, dpeKwhM2: 100, dpeDate: "2019-01-01", buildingType: "maison" }),
      cert({ surface: 52, dpeKwhM2: 280, dpeDate: "2024-06-01", buildingType: "maison" }),
    ];
    const sels = computeSelectivities(input, pool);
    const s = scoreCertificate(input, pool[0]!, sels);
    expect(recompute(s.breakdown)).toBeCloseTo(s.score, 3);
  });

  it("un attribut isolé ne rapporte rien : il faut que TOUT le combo s'allume", () => {
    // Cert dont seule la surface matche, mais l'épine (date×conso) est cassée.
    const input: ResolverInput = { postalCode: "40500", surface: 50, dpeKwhM2: 285, dpeDate: "2023-10-25" };
    const pool = [
      cert({ surface: 50, dpeKwhM2: 999, dpeDate: "2000-01-01" }), // surface OK, épine KO
      cert({ surface: 50, dpeKwhM2: 285, dpeDate: "2023-10-25" }), // tout OK
    ];
    const sels = computeSelectivities(input, pool);
    const isolated = scoreCertificate(input, pool[0]!, sels);
    expect(isolated.score).toBe(0); // épine éteinte → tous les combos à 0
  });

  it("surface qui diverge → le combo surface s'éteint mais l'épine porte le score", () => {
    const input: ResolverInput = { postalCode: "40500", surface: 57, dpeKwhM2: 285, dpeDate: "2023-10-25" };
    const pool = [
      cert({ surface: 284, dpeKwhM2: 285, dpeDate: "2023-10-25" }),
      cert({ surface: 50, dpeKwhM2: 999, dpeDate: "2000-01-01" }),
    ];
    const sels = computeSelectivities(input, pool);
    const s = scoreCertificate(input, pool[0]!, sels);
    const surf = s.breakdown.find((b) => b.criterion === "épine×surface")!;
    expect(surf.similarity).toBe(0); // 284 vs 57 hors tolérance
    expect(s.score).toBeGreaterThan(0); // épine (date×conso) intacte
  });

  it("date concordante via le fallback date_visite_diagnostiqueur", () => {
    const c = cert({ dpeDate: "2026-05-14", dpeVisitDate: "2026-05-12" });
    const input: ResolverInput = { postalCode: "40500", dpeDate: "2026-05-12" };
    const sels = computeSelectivities(input, [c, cert({ dpeDate: "2000-01-01" })]);
    const s = scoreCertificate(input, c, sels);
    const spine = s.breakdown.find((b) => b.criterion === "épine")!;
    expect(spine.factors!.find((f) => f.criterion === "dpeDate")!.similarity).toBe(1);
  });

  it("tolérance conso resserrée : une conso ~9 % off n'est plus « exacte »", () => {
    // La conso EST la vraie valeur du DPE → tolérance serrée (±3 %). Un écart de
    // ~9 % (296 vs 328) doit décroître nettement, pas valoir 1 comme avant.
    const input: ResolverInput = { postalCode: "40500", dpeKwhM2: 328, propertyType: "Appartement" };
    const exact = cert({ dpeKwhM2: 328, buildingType: "appartement" });
    const off = cert({ dpeKwhM2: 296, buildingType: "appartement" });
    const sels = computeSelectivities(input, [exact, off]);
    const spineOf = (c: AdemeCertificate) =>
      scoreCertificate(input, c, sels).breakdown
        .find((b) => b.criterion === "épine")!
        .factors!.find((f) => f.criterion === "dpeKwhM2")!.similarity;
    expect(spineOf(exact)).toBe(1);
    expect(spineOf(off)).toBeLessThan(0.5);
  });

  it("DPE chiffré exclut la lettre (exclusivité)", () => {
    const c = cert({ dpeKwhM2: 285, dpeClass: "E", dpeDate: "2023-10-25" });
    const input: ResolverInput = { postalCode: "40500", dpeKwhM2: 285, dpeClass: "E", dpeDate: "2023-10-25" };
    const sels = computeSelectivities(input, [c]);
    const s = scoreCertificate(input, c, sels);
    const factors = s.breakdown.flatMap((b) => b.factors ?? []).map((f) => f.criterion);
    expect(factors).toContain("dpeKwhM2");
    expect(factors).not.toContain("dpeClass");
  });
});
