import { describe, expect, it, vi } from "vitest";
import { resolveAddress } from "./index";

const ADEME_HOST = "data.ademe.fr";
const APICARTO_HOST = "apicarto.ign.fr";

function makeFetch(
  ademeResults: Record<string, unknown>[],
  parcel?: Record<string, unknown>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(ADEME_HOST)) {
      return new Response(JSON.stringify({ results: ademeResults }));
    }
    if (url.includes(APICARTO_HOST)) {
      return new Response(
        JSON.stringify({ features: parcel ? [{ properties: parcel }] : [] }),
      );
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("resolveAddress", () => {
  it("retourne [] quand le code postal est absent", async () => {
    const res = await resolveAddress({ postalCode: "" });
    expect(res).toEqual([]);
  });

  it("interroge ADEME, score et ajoute la parcelle cadastrale au top-1", async () => {
    const fetchFn = makeFetch(
      [
        {
          numero_dpe: "A",
          adresse_ban: "18 Rue Béranger 75003 Paris",
          code_postal_ban: "75003",
          nom_commune_ban: "Paris",
          ban_y: 48.8674,
          ban_x: 2.3635,
          surface_habitable_logement: 88,
          type_batiment: "appartement",
          etiquette_dpe: "C",
          conso_5_usages_par_m2_ep: 165,
          emission_ges_5_usages_par_m2: 28,
          etiquette_ges: "C",
        },
        {
          numero_dpe: "B",
          adresse_ban: "20 Rue Autre 75003 Paris",
          code_postal_ban: "75003",
          surface_habitable_logement: 88,
          type_batiment: "appartement",
          etiquette_dpe: "F",
          conso_5_usages_par_m2_ep: 380,
        },
      ],
      {
        id: "75103000AB0042",
        code_insee: "75103",
        section: "AB",
        numero: "0042",
      },
    );

    const res = await resolveAddress(
      {
        postalCode: "75003",
        surface: 88,
        dpeKwhM2: 165,
        propertyType: "Appartement",
      },
      { fetchFn },
    );
    expect(res).toHaveLength(2);
    expect(res[0]!.ademeCertId).toBe("A");
    expect(res[0]!.confidence).toBeGreaterThan(res[1]!.confidence);
    expect(res[0]!.parcelId).toBe("75103000AB0042");
    // Le second candidat n'a pas de lookup cadastre (best-effort top-1 only).
    expect(res[1]!.parcelId).toBeUndefined();
  });

  it("survit à un échec du cadastre (best-effort)", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(ADEME_HOST)) {
        return new Response(
          JSON.stringify({
            results: [
              {
                numero_dpe: "A",
                code_postal_ban: "75003",
                adresse_ban: "X",
                surface_habitable_logement: 88,
                ban_x: 2,
                ban_y: 48,
              },
            ],
          }),
        );
      }
      return new Response("err", { status: 503 });
    }) as unknown as typeof fetch;

    const res = await resolveAddress(
      { postalCode: "75003", surface: 88 },
      { fetchFn },
    );
    expect(res).toHaveLength(1);
    expect(res[0]!.parcelId).toBeUndefined();
    expect(res[0]!.confidence).toBeGreaterThan(0);
  });
});
