import { describe, expect, it, vi } from "vitest";
import { lookupParcel } from "./cadastre.ts";

// Feature apicarto réaliste (champs réellement renvoyés : `idu`, pas `id`).
function feature(over: Record<string, unknown> = {}) {
  return {
    properties: {
      idu: "40001000CL0096",
      code_insee: "40001",
      section: "CL",
      numero: "0096",
      contenance: 61,
      ...over,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-0.2644, 43.7030],
        [-0.2643, 43.7030],
        [-0.2643, 43.7031],
        [-0.2644, 43.7031],
        [-0.2644, 43.7030],
      ]],
    },
  };
}

function fetchReturning(...responses: unknown[]) {
  const queue = [...responses];
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => queue.shift() ?? { features: [] },
  })) as unknown as typeof fetch;
}

describe("lookupParcel", () => {
  it("lit le champ `idu` d'apicarto (régression : lisait `id`, toujours null)", async () => {
    const fetchFn = fetchReturning({ features: [feature()] });
    const parcel = await lookupParcel({ lat: 43.703086, lon: -0.264382, fetchFn });
    expect(parcel).not.toBeNull();
    expect(parcel?.id).toBe("40001000CL0096");
    expect(parcel?.section).toBe("CL");
    expect(parcel?.numero).toBe("96"); // zéros de tête retirés
    expect(parcel?.contenance).toBe(61);
  });

  it("retombe sur le tampon quand le point ne renvoie aucune parcelle", async () => {
    // 1re réponse (point) vide → 2e réponse (tampon) avec la parcelle.
    const fetchFn = fetchReturning({ features: [] }, { features: [feature()] });
    const parcel = await lookupParcel({ lat: 43.703086, lon: -0.264382, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(parcel?.numero).toBe("96");
  });

  it("renvoie null si ni le point ni le tampon ne trouvent de parcelle", async () => {
    const fetchFn = fetchReturning({ features: [] }, { features: [] });
    const parcel = await lookupParcel({ lat: 0, lon: 0, fetchFn });
    expect(parcel).toBeNull();
  });
});
