import { describe, expect, it, vi } from "vitest";
import { fetchCopropriete, matchCopropriete } from "./copropriete.ts";
import type { CoproprieteParcel } from "./copropriete.ts";

/** Ligne RNIC minimale pour les tests. */
function row(fields: Record<string, string | number | null>): Record<string, unknown> {
  return {
    nombre_total_lots: null,
    nombre_lots_habitation: null,
    nom_usage_copropriete: null,
    section_parcelle_1: null,
    numero_parcelle_1: null,
    section_parcelle_2: null,
    numero_parcelle_2: null,
    section_parcelle_3: null,
    numero_parcelle_3: null,
    ...fields,
  };
}

/**
 * fetchFn simulé : route selon l'URL. `direct` = requête IDU exact, `address` =
 * requête code postal + rue, `box` = bounding box. `undefined` = liste vide.
 */
function stubFetch(opts: { direct?: unknown[]; address?: unknown[]; box?: unknown[] }) {
  return vi.fn(async (url: string) => {
    let data: unknown[] = [];
    if (url.includes("latitude__greater")) data = opts.box ?? [];
    else if (url.includes("code_postal_adresse__exact")) data = opts.address ?? [];
    else if (url.includes("reference_cadastrale_1__exact")) data = opts.direct ?? [];
    return { ok: true, json: async () => ({ data }) } as unknown as Response;
  });
}

const PARIS: CoproprieteParcel = {
  id: "75102000AE0032",
  section: "AE",
  numero: "32",
  lat: 48.866957,
  lon: 2.336702,
};

describe("fetchCopropriete — match direct par IDU", () => {
  it("commune standard : IDU trouvé sur reference_cadastrale_1", async () => {
    const fetchFn = stubFetch({
      direct: [
        row({ nombre_total_lots: "39", nombre_lots_habitation: "18", nom_usage_copropriete: "0149 - SDC 20 RUE GRAMONT" }),
      ],
    });
    const parcel: CoproprieteParcel = { id: "44109000AB0042", section: "AB", numero: "42" };

    const res = await fetchCopropriete(parcel, { fetchFn: fetchFn as unknown as typeof fetch });

    expect(res).toEqual({ isCopropriete: true, lotsTotal: 39, lotsHabitation: 18, nom: "SDC 20 RUE GRAMONT" });
    // Un seul appel : le match direct suffit, pas de repli.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0]![0] as string)).toContain("reference_cadastrale_1__exact=44109000AB0042");
  });

  it("nom sans préfixe technique reste tel quel", async () => {
    const fetchFn = stubFetch({ direct: [row({ nombre_total_lots: "12", nom_usage_copropriete: "RESIDENCE LES TILLEULS" })] });
    const res = await fetchCopropriete({ id: "44109000AB0042", section: "AB", numero: "42" }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res?.nom).toBe("RESIDENCE LES TILLEULS");
  });
});

describe("fetchCopropriete — repli géographique (Paris/Lyon/Marseille)", () => {
  it("IDU cadastre ≠ IDU registre : match par section+numéro dans la bounding box", async () => {
    const fetchFn = stubFetch({
      direct: [], // 75102000AE0032 introuvable tel quel dans le registre
      box: [
        row({ section_parcelle_1: "AB", numero_parcelle_1: "0011", nombre_total_lots: "8" }), // voisin, ne matche pas
        row({ section_parcelle_1: "AE", numero_parcelle_1: "0032", nombre_total_lots: "45", nombre_lots_habitation: "27" }),
      ],
    });

    const res = await fetchCopropriete(PARIS, { fetchFn: fetchFn as unknown as typeof fetch });

    expect(res).toEqual({ isCopropriete: true, lotsTotal: 45, lotsHabitation: 27 });
    // 2 appels : direct (vide) puis bounding box.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1]![0] as string)).toContain("latitude__greater");
  });

  it("copro multi-parcelles : la parcelle du bien est en 2ᵉ emplacement", async () => {
    const fetchFn = stubFetch({
      direct: [],
      box: [
        row({
          section_parcelle_1: "CL", numero_parcelle_1: "0100",
          section_parcelle_2: "AE", numero_parcelle_2: "0032",
          nombre_total_lots: "60", nombre_lots_habitation: "40",
        }),
      ],
    });
    const res = await fetchCopropriete(PARIS, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toMatchObject({ isCopropriete: true, lotsTotal: 60, lotsHabitation: 40 });
  });

  it("aucune parcelle de la box ne matche → null (pas de faux positif)", async () => {
    const fetchFn = stubFetch({
      direct: [],
      box: [row({ section_parcelle_1: "ZZ", numero_parcelle_1: "9999", nombre_total_lots: "5" })],
    });
    const res = await fetchCopropriete(PARIS, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toBeNull();
  });
});

describe("fetchCopropriete — match par adresse (parcelle imprécise Le Bon Coin)", () => {
  // Cas réel : annonce « 141 Rue Marie Curie, 40280 » ; le cadastre a pointé
  // AB0887 (aucune copro), mais l'adresse tombe pile sur LES COTEAUX (144 lots).
  const bien: CoproprieteParcel = {
    id: "40281000AB0887",
    section: "AB",
    numero: "887",
    address: "141 Rue Marie Curie, 40280 Saint-Pierre-du-Mont",
    lat: 43.879841,
    lon: -0.523134,
  };
  const rows = [
    row({ numero_voie_adresse: "141 r marie curie", code_postal_adresse: "40280", nombre_total_lots: "144", nombre_lots_habitation: "120", nom_usage_copropriete: "SDCLES COTEAUX DE SAINT PIERRE" }),
    row({ numero_voie_adresse: "53 r marie curie", code_postal_adresse: "40280", nombre_total_lots: "108" }),
    row({ numero_voie_adresse: "250 r frederic joliot curie", code_postal_adresse: "40280", nombre_total_lots: "31" }),
  ];

  it("la parcelle ne donne rien → l'adresse trouve la bonne copro au numéro près", async () => {
    const fetchFn = stubFetch({ direct: [], address: rows });
    const res = await fetchCopropriete(bien, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toMatchObject({ isCopropriete: true, lotsTotal: 144, lotsHabitation: 120 });
    // Direct (vide) puis requête adresse — pas de bounding box nécessaire.
    const urls = fetchFn.mock.calls.map((c) => c[0] as string);
    expect(urls[1]).toContain("code_postal_adresse__exact=40280");
    expect(urls[1]).toContain("numero_voie_adresse__contains=");
  });

  it("ne confond pas avec le n° 53 de la même rue (autre copro)", async () => {
    const fetchFn = stubFetch({ direct: [], address: rows });
    const res = await fetchCopropriete({ ...bien, address: "53 Rue Marie Curie, 40280 Saint-Pierre-du-Mont" }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res?.lotsTotal).toBe(108);
  });

  it("numéro absent au registre → pas de match adresse (pas de faux positif)", async () => {
    const fetchFn = stubFetch({ direct: [], address: rows });
    const res = await fetchCopropriete({ ...bien, address: "999 Rue Marie Curie, 40280 Saint-Pierre-du-Mont" }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it("le match direct par IDU a priorité (pas de requête adresse)", async () => {
    const fetchFn = stubFetch({ direct: [row({ nombre_total_lots: "12" })], address: rows });
    const res = await fetchCopropriete(bien, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.lotsTotal).toBe(12);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fonctionne sans parcelle, avec la seule adresse", async () => {
    const fetchFn = stubFetch({ address: rows });
    const res = await fetchCopropriete({ id: "", section: "", numero: "", address: bien.address }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res?.lotsTotal).toBe(144);
    // Pas d'IDU → on ne requête pas reference_cadastrale ; on va direct à l'adresse.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchCopropriete — non trouvé", () => {
  it("ni direct ni box → null (on n'affirme pas « maison »)", async () => {
    const fetchFn = stubFetch({ direct: [], box: [] });
    const res = await fetchCopropriete(PARIS, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toBeNull();
  });

  it("sans lat/lon, pas de repli géographique (un seul appel)", async () => {
    const fetchFn = stubFetch({ direct: [] });
    const res = await fetchCopropriete({ id: "44109000AB0042", section: "AB", numero: "42" }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ligne sans nombre de lots exploitable → null", async () => {
    const fetchFn = stubFetch({ direct: [row({ nombre_total_lots: null })] });
    const res = await fetchCopropriete({ id: "44109000AB0042", section: "AB", numero: "42" }, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it("propage une erreur HTTP dure", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(
      fetchCopropriete({ id: "44109000AB0042", section: "AB", numero: "42" }, {
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("matchCopropriete — normalisation section/numéro", () => {
  const parcel: CoproprieteParcel = { id: "12345000AB0096", section: "AB", numero: "96" };

  it("numéro paddé côté registre (0096) matche le numéro nu (96)", () => {
    const rows = [row({ section_parcelle_1: "AB", numero_parcelle_1: "0096", nombre_total_lots: "7" })];
    expect(matchCopropriete(rows, parcel)).not.toBeNull();
  });

  it("section avec zéro de tête (0A) matche (A)", () => {
    const rows = [row({ section_parcelle_1: "0A", numero_parcelle_1: "0096" })];
    expect(matchCopropriete(rows, { ...parcel, section: "A" })).not.toBeNull();
  });

  it("section différente ne matche pas", () => {
    const rows = [row({ section_parcelle_1: "AC", numero_parcelle_1: "0096" })];
    expect(matchCopropriete(rows, parcel)).toBeNull();
  });
});
