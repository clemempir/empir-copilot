import { describe, expect, it, vi } from "vitest";
import { resolveAddress } from "./index";

const ADEME_HOST = "data.ademe.fr";
const APICARTO_HOST = "apicarto.ign.fr";

interface RowOpts {
  id: string;
  address: string;
  geo?: string; // "lat,lon"
  surface?: number;
  surfaceImm?: number;
  apts?: number;
  type?: string;
  dpe?: string;
  kwh?: number;
  gesClass?: string;
  ges?: number;
  year?: number;
  date?: string;
  visit?: string;
  banId?: string;
  cp?: string;
}

function row(o: RowOpts): Record<string, unknown> {
  return {
    numero_dpe: o.id,
    adresse_ban: o.address,
    code_postal_ban: o.cp ?? "40500",
    nom_commune_ban: "Saint-Sever",
    _geopoint: o.geo,
    surface_habitable_logement: o.surface,
    surface_habitable_immeuble: o.surfaceImm,
    nombre_appartement: o.apts,
    type_batiment: o.type ?? "maison",
    etiquette_dpe: o.dpe,
    conso_5_usages_par_m2_ep: o.kwh,
    emission_ges_5_usages_par_m2: o.ges,
    etiquette_ges: o.gesClass,
    annee_construction: o.year,
    date_etablissement_dpe: o.date,
    date_visite_diagnostiqueur: o.visit,
    identifiant_ban: o.banId ?? o.address,
  };
}

function makeFetch(rows: Record<string, unknown>[]): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(ADEME_HOST)) return new Response(JSON.stringify({ results: rows }));
    if (url.includes(APICARTO_HOST)) return new Response(JSON.stringify({ features: [] }));
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

/** Bruit : N certs « ordinaires » à des dates/surfaces variées. */
function noise(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `N${i}`,
      address: `${i} Rue Ordinaire`,
      geo: `43.74${i},-0.58${i}`,
      surface: 70 + i * 3,
      type: "maison",
      dpe: "D",
      kwh: 200 + i,
      date: `2019-0${(i % 9) + 1}-15`,
    }),
  );
}

describe("resolveAddress — marqueur géo précis", () => {
  it("le marqueur SeLoger (~4 m) décide l'adresse (Castallet), confiance haute", async () => {
    const rows = [
      row({
        id: "2340E3064983P",
        address: "32 Rue du Castallet 40500 Saint-Sever",
        geo: "43.75320,-0.57065", // ~4 m du marqueur
        surface: 50,
        type: "maison",
        dpe: "G",
        gesClass: "C",
      }),
      // décoy lointain (~1,5 km) qui matche AUSSI surface/DPE
      row({
        id: "DECOY",
        address: "99 Rue Lointaine 40500 Saint-Sever",
        geo: "43.74000,-0.58500",
        surface: 50,
        type: "maison",
        dpe: "G",
        gesClass: "C",
      }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 50,
        dpeClass: "G",
        gesClass: "C",
        propertyType: "Maison",
        geo: { lat: 43.75323, lon: -0.57068 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Castallet");
    expect(res[0]!.resolved).toBe(true);
    expect(res[0]!.confidence).toBeGreaterThanOrEqual(85);
    expect(res[0]!.flags).toContain("geo-decided");
    // Le décoy lointain est écarté par le gate spatial.
    expect(res.some((r) => r.ademeCertId === "DECOY")).toBe(false);
  });

  it("DPE au point en contradiction → conflict + non résolu", async () => {
    const rows = [
      // seul cert au point : immeuble 400 m² classe B, alors que l'annonce dit maison 50 m² G
      row({
        id: "CONFLICT",
        address: "1 Place du Conflit 40500 Saint-Sever",
        geo: "43.75320,-0.57065",
        surfaceImm: 400,
        type: "immeuble",
        dpe: "B",
      }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 50,
        dpeClass: "G",
        propertyType: "Maison",
        geo: { lat: 43.75323, lon: -0.57068 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.resolved).toBe(false);
    expect(res[0]!.flags).toContain("conflict");
    expect(res[0]!.confidence).toBeLessThan(50);
  });
});

describe("resolveAddress — désambiguïsation par attributs (sans géo)", () => {
  it("immeuble Pontix : la date + la surface immeuble rares le font gagner", async () => {
    const rows = [
      row({
        id: "PONTIX",
        address: "12 Rue de Pontix 40500 Saint-Sever",
        geo: "43.758,-0.575",
        surfaceImm: 284,
        apts: 5,
        type: "immeuble",
        dpe: "E",
        date: "2023-10-25",
      }),
      ...noise(10),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 284,
        apartmentCount: 5,
        dpeClass: "E",
        dpeDate: "2023-10-25",
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Pontix");
    expect(res[0]!.resolved).toBe(true);
  });

  it("Leboncoin immeuble Ursulines : la date de diagnostic unique tranche", async () => {
    const rows = [
      row({
        id: "URSULINES",
        address: "24 Rue des Ursulines 40500 Saint-Sever",
        geo: "43.757,-0.576",
        surfaceImm: 150,
        type: "immeuble",
        dpe: "D",
        date: "2023-12-19",
      }),
      ...noise(12),
    ];
    const res = await resolveAddress(
      { postalCode: "40500", surface: 150, dpeClass: "D", dpeDate: "2023-12-19" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Ursulines");
    expect(res[0]!.resolved).toBe(true);
  });

  it("Papin : le fallback date_visite évite un faux positif (date_etablissement décalée)", async () => {
    const rows = [
      row({
        id: "PAPIN",
        address: "10 Rue de Papin 40500 Saint-Sever",
        geo: "43.756,-0.577",
        surface: 46,
        type: "appartement",
        dpe: "C",
        kwh: 127,
        date: "2026-05-14", // établissement décalé de 2 j
        visit: "2026-05-12", // visite = date affichée → fallback
      }),
      // décoy : bonne date d'établissement mais tout le reste faux
      row({
        id: "DECOY",
        address: "77 Rue Piège 40500 Saint-Sever",
        geo: "43.74,-0.59",
        surface: 120,
        type: "appartement",
        dpe: "F",
        kwh: 350,
        date: "2026-05-12",
      }),
      ...noise(8),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 46,
        dpeClass: "C",
        dpeKwhM2: 127,
        dpeDate: "2026-05-12",
        propertyType: "Appartement",
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Papin");
    expect(res[0]!.resolved).toBe(true);
    const dateRow = res[0]!.matchBreakdown.find((b) => b.criterion === "dpeDate");
    expect(dateRow?.similarity).toBe(1);
  });
});

describe("resolveAddress — anti-faux-positif (resolved:false)", () => {
  it("maison 228 m² SANS DPE → ne résout pas (aucun signal discriminant)", async () => {
    const rows = [
      row({ id: "A", address: "1 Rue A", surface: 228, type: "maison" }),
      row({ id: "B", address: "2 Rue B", surface: 230, type: "maison" }),
      row({ id: "C", address: "3 Rue C", surface: 226, type: "maison" }),
      ...noise(5),
    ];
    const res = await resolveAddress(
      { postalCode: "40500", surface: 228, propertyType: "Maison" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.resolved).toBe(false);
    expect(res.length).toBeGreaterThan(1); // candidates exposés
  });

  it("marge faible : 2 adresses au score quasi égal → non résolu + candidates[]", async () => {
    const rows = [
      row({ id: "A", address: "1 Rue Jumelle", surface: 50, dpe: "G", date: "2024-01-01" }),
      row({ id: "B", address: "2 Rue Jumelle", surface: 50, dpe: "G", date: "2024-01-01" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40500", surface: 50, dpeClass: "G", dpeDate: "2024-01-01" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.resolved).toBe(false);
    expect(res[0]!.flags).toContain("low-margin");
    expect(res.length).toBeGreaterThanOrEqual(2);
  });

  it("retourne [] sans code postal", async () => {
    const res = await resolveAddress({ postalCode: "" });
    expect(res).toEqual([]);
  });
});
