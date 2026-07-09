import { describe, expect, it } from "vitest";
import { getZonePatrimoine } from "./patrimoine.ts";

// Feature GPU réaliste : champ `suptype` en minuscule, nom dans `nomsuplitt`.
function feat(suptype: string, nomsuplitt?: string | null) {
  return { properties: { suptype, nomsuplitt } };
}

describe("getZonePatrimoine", () => {
  it("détecte AC1 (abords MH) malgré la casse minuscule", () => {
    const zp = getZonePatrimoine({ features: [feat("ac1", "Ancien Evêché")] });
    expect(zp?.concerne).toBe(true);
    expect(zp?.categories[0]?.code).toBe("AC1");
    expect(zp?.categories[0]?.label).toMatch(/monument historique/i);
  });

  it("détecte AC4 (SPR) et remonte le nom littéral", () => {
    const zp = getZonePatrimoine({ features: [feat("ac4", "Site patrimonial remarquable de Sarlat")] });
    expect(zp?.concerne).toBe(true);
    expect(zp?.categories[0]?.code).toBe("AC4");
    expect(zp?.categories[0]?.nom).toBe("Site patrimonial remarquable de Sarlat");
  });

  it("répare le mojibake du nom (Evêché)", () => {
    const zp = getZonePatrimoine({ features: [feat("ac1", "Ancien EvÃªchÃ© & Mairie")] });
    expect(zp?.categories[0]?.nom).toBe("Ancien Evêché & Mairie");
  });

  it("ignore les autres servitudes (AC2, PM1…) et dédup par catégorie", () => {
    const zp = getZonePatrimoine({
      features: [feat("pm1"), feat("ac2"), feat("ac1", "A"), feat("ac1", "B")],
    });
    expect(zp?.concerne).toBe(true);
    expect(zp?.categories).toHaveLength(1); // AC1 dédupliqué
  });

  it("renvoie non-concerné quand aucune servitude patrimoniale", () => {
    const zp = getZonePatrimoine({ features: [feat("pm1")] });
    expect(zp).not.toBeNull();
    expect(zp?.concerne).toBe(false);
    expect(zp?.categories).toHaveLength(0);
  });

  it("renvoie null (indisponible) quand le service n'a rien renvoyé", () => {
    expect(getZonePatrimoine(null)).toBeNull();
    expect(getZonePatrimoine(undefined)).toBeNull();
  });
});
