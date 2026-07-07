import { describe, expect, it, vi } from "vitest";
import { fetchAdemeCertificates } from "./ademe.ts";

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("fetchAdemeCertificates", () => {
  it("interroge le dataset enrichi (meg-…) en premier, avec filtre code_postal_ban_eq", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] })),
    ) as unknown as typeof fetch;
    await fetchAdemeCertificates({ postalCode: "75003", fetchFn });
    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(1);
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("meg-83tjwtg8dyz4vv7h1dqe");
    expect(calledUrl).toContain("code_postal_ban_eq=75003");
  });

  it("retombe sur dpe03existant si le dataset principal répond en erreur", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes("dpe03existant")
        ? new Response(JSON.stringify({ results: [] }))
        : new Response("err", { status: 500 }),
    ) as unknown as typeof fetch;
    await fetchAdemeCertificates({ postalCode: "75003", fetchFn });
    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(2);
    expect(mock.mock.calls[1]?.[0] as string).toContain("dpe03existant");
  });

  it("ne filtre PLUS par type_batiment (les DPE immeuble doivent passer)", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] })),
    ) as unknown as typeof fetch;
    await fetchAdemeCertificates({ postalCode: "75003", buildingType: "Appartement", fetchFn });
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).not.toContain("type_batiment_eq");
    // La surface immeuble est demandée pour ne pas jeter les lignes immeuble.
    expect(url).toContain("surface_habitable_immeuble");
  });

  it("retombe sur surface_habitable_immeuble quand la surface logement est nulle", async () => {
    const fetchFn = mockFetch({
      results: [
        {
          numero_dpe: "IMM-1",
          adresse_ban: "12 Rue de Pontix 40500 Saint-Sever",
          code_postal_ban: "40500",
          _geopoint: "43.75832,-0.57554",
          surface_habitable_immeuble: 284,
          type_batiment: "immeuble",
          etiquette_dpe: "E",
        },
      ],
    });
    const certs = await fetchAdemeCertificates({ postalCode: "40500", fetchFn });
    expect(certs).toHaveLength(1);
    expect(certs[0]!.surface).toBe(284);
    expect(certs[0]!.buildingType).toBe("immeuble");
  });

  it("normalise les certificats (numero_dpe, surface, _geopoint, etc.)", async () => {
    const fetchFn = mockFetch({
      results: [
        {
          numero_dpe: "2389E10000XYZ",
          adresse_ban: "18 Rue Béranger 75003 Paris",
          code_postal_ban: "75003",
          nom_commune_ban: "Paris",
          _geopoint: "48.8674,2.3635",
          surface_habitable_logement: 88,
          type_batiment: "appartement",
          etiquette_dpe: "C",
          conso_5_usages_par_m2_ep: 165,
          emission_ges_5_usages_par_m2: 28,
          etiquette_ges: "C",
          annee_construction: 1976,
        },
      ],
    });
    const certs = await fetchAdemeCertificates({ postalCode: "75003", fetchFn });
    expect(certs).toHaveLength(1);
    const c = certs[0]!;
    expect(c.certId).toBe("2389E10000XYZ");
    expect(c.surface).toBe(88);
    expect(c.lat).toBeCloseTo(48.8674, 4);
    expect(c.lon).toBeCloseTo(2.3635, 4);
    expect(c.dpeClass).toBe("C");
    expect(c.dpeKwhM2).toBe(165);
    expect(c.yearBuilt).toBe(1976);
  });

  it("ignore les rows incomplets (sans numero_dpe ou surface)", async () => {
    const fetchFn = mockFetch({
      results: [
        { numero_dpe: "OK", surface_habitable_logement: 50, code_postal_ban: "75003" },
        { surface_habitable_logement: 70, code_postal_ban: "75003" }, // no id
        { numero_dpe: "X", code_postal_ban: "75003" }, // no surface
      ],
    });
    const certs = await fetchAdemeCertificates({ postalCode: "75003", fetchFn });
    expect(certs).toHaveLength(1);
    expect(certs[0]!.certId).toBe("OK");
  });

  it("propage l'erreur HTTP quand TOUS les datasets échouent", async () => {
    const fetchFn = vi.fn(async () => new Response("err", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchAdemeCertificates({ postalCode: "75003", fetchFn })).rejects.toThrow(
      /ADEME 503/,
    );
    // Les deux datasets ont bien été tentés avant d'abandonner.
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
