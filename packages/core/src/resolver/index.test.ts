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

describe("resolveAddress — marqueur géo précis (gate)", () => {
  it("SeLoger maison 50 m² G/C, marqueur ~4 m → Castallet, status confirmed", async () => {
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
        geo: { lat: 43.75323, lon: -0.57068, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Castallet");
    expect(res[0]!.status).toBe("confirmed");
    expect(res[0]!.resolved).toBe(true);
    expect(res[0]!.confidence).toBeGreaterThanOrEqual(85);
    expect(res[0]!.flags).toContain("geo-corroborated");
    // Le décoy lointain est écarté par le gate spatial.
    expect(res.some((r) => r.ademeCertId === "DECOY")).toBe(false);
  });

  it("marqueur sur une MAISON alors que l'annonce est un APPARTEMENT E/C → conflict (surface proche ne sauve pas)", async () => {
    // Régression : un cert maison C/A à 5 m, surface ~proche (63 vs 69), ne doit
    // PAS être confirmé pour un appartement E/C — la cohérence se base sur la
    // signature énergétique + le type, pas sur la surface.
    const rows = [
      row({
        id: "WRONG",
        address: "11bis Rue Dulaurier 40000 Mont-de-Marsan",
        geo: "43.89583,-0.50436", // ~1 m du marqueur
        surface: 63,
        type: "maison",
        dpe: "C",
        gesClass: "A",
      }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40000",
        surface: 69,
        dpeClass: "E",
        gesClass: "C",
        propertyType: "Appartement",
        geo: { lat: 43.89583, lon: -0.50435, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
    expect(res[0]!.flags).toContain("conflict");
  });

  it("DPE au point en contradiction → conflict + unresolved (jamais auto-résolu)", async () => {
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
        geo: { lat: 43.75323, lon: -0.57068, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
    expect(res[0]!.flags).toContain("conflict");
    expect(res[0]!.confidence).toBeLessThan(50);
  });
});

describe("resolveAddress — empreinte DPE (conso exacte unique)", () => {
  it("conso exacte UNIQUE → probable dpe-fingerprint (départage deux sosies)", async () => {
    // A et B se ressemblent (65 m² E, conso à ±3 % → égalité en primaire, unresolved),
    // mais seule A matche la conso à la précision d'arrondi (328 vs 320).
    const rows = [
      row({ id: "A", address: "3bis Rue Test", surface: 65, type: "appartement", dpe: "E", kwh: 328 }),
      row({ id: "B", address: "9 Rue Sosie", surface: 65, type: "appartement", dpe: "E", kwh: 320 }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40000", surface: 65, dpeClass: "E", dpeKwhM2: 328, propertyType: "Appartement" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("probable");
    expect(res[0]!.flags).toContain("dpe-fingerprint");
    expect(res[0]!.ademeCertId).toBe("A");
  });

  it("conso exacte MAIS surface/GES divergents → PAS d'empreinte (anti-faux-positif)", async () => {
    // Cas réel (Bourg-Neuf) : une conso banale (207) partagée par un autre logement
    // de surface/GES différents ne doit pas déclencher l'empreinte.
    const rows = [
      row({ id: "DECOY", address: "245 Rue Loin", surface: 58, type: "appartement", dpe: "D", kwh: 207, gesClass: "A" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40000", surface: 66, dpeClass: "D", dpeKwhM2: 207, gesClass: "B", propertyType: "Appartement" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res.some((r) => r.flags?.includes("dpe-fingerprint"))).toBe(false);
  });

  it("deux certs à la MÊME conso exacte → ambigu, pas d'empreinte (unresolved)", async () => {
    const rows = [
      row({ id: "A", address: "1 Rue Jumelle", surface: 65, type: "appartement", dpe: "E", kwh: 328 }),
      row({ id: "B", address: "2 Rue Jumelle", surface: 65, type: "appartement", dpe: "E", kwh: 328 }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40000", surface: 65, dpeClass: "E", dpeKwhM2: 328, propertyType: "Appartement" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res.some((r) => r.flags?.includes("dpe-fingerprint"))).toBe(false);
    expect(res[0]!.status).toBe("unresolved");
  });
});

describe("resolveAddress — lot dans immeuble (DPE de lot absent)", () => {
  it("appartement E sans DPE de lot → rattaché à l'immeuble E, plausibilité surface/lot", async () => {
    const rows = [
      // au point : maison C (mauvais type + DPE) → conflit, non résolu
      row({ id: "M", address: "11bis Rue Dulaurier", geo: "43.89587,-0.50435", surface: 63, type: "maison", dpe: "C" }),
      // immeuble E de 10 logements (550 m²) à ~65 m → lot 69 m² plausible
      row({ id: "IMM550", address: "106 Av Rozanoff", geo: "43.89525,-0.50435", surfaceImm: 550, apts: 10, type: "immeuble", dpe: "E" }),
      // immeuble E de 4 logements (128 m²) à ~64 m → lot 69 m² IMPOSSIBLE (> moitié)
      row({ id: "IMM128", address: "68 Av Rozanoff", geo: "43.89526,-0.50440", surfaceImm: 128, apts: 4, type: "immeuble", dpe: "E" }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40000",
        surface: 69,
        dpeClass: "E",
        propertyType: "Appartement",
        geo: { lat: 43.89583, lon: -0.50435, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("probable");
    expect(res[0]!.flags).toContain("lot-in-building");
    expect(res[0]!.address).toContain("106 Av Rozanoff");
    // L'immeuble de 4 logements (trop petit pour un lot de 69 m²) est écarté.
    expect(res.some((r) => r.ademeCertId === "IMM128" && r.flags?.includes("lot-in-building"))).toBe(false);
  });

  it("géo DISQUE (floutage, non précis) → le canal lot-in-building ne se déclenche PAS", async () => {
    // Un immeuble E est proche du centroïde, mais la géo est un disque → la
    // distance au centroïde n'a aucun sens, on ne doit pas inventer un rattachement.
    const rows = [
      row({ id: "M", address: "1 Rue X", geo: "43.898,-0.500", surface: 80, type: "maison", dpe: "D" }),
      row({ id: "IMM", address: "9 Av Y", geo: "43.8981,-0.5001", surfaceImm: 550, apts: 10, type: "immeuble", dpe: "E" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40000",
        surface: 65,
        dpeClass: "E",
        propertyType: "Appartement",
        geo: { lat: 43.898, lon: -0.5001, radiusM: 780 }, // disque, precise absent
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res.some((r) => r.flags?.includes("lot-in-building"))).toBe(false);
  });

  it("appartement sans immeuble concordant → reste unresolved (pas d'invention)", async () => {
    const rows = [
      row({ id: "M", address: "1 Rue X", geo: "43.89587,-0.50435", surface: 63, type: "maison", dpe: "C" }),
      // immeuble proche mais DPE D (≠ E annonce) → pas rattaché
      row({ id: "IMMD", address: "9 Av Y", geo: "43.89525,-0.50435", surfaceImm: 500, apts: 9, type: "immeuble", dpe: "D" }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40000",
        surface: 69,
        dpeClass: "E",
        propertyType: "Appartement",
        geo: { lat: 43.89583, lon: -0.50435, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
    expect(res.some((r) => r.flags?.includes("lot-in-building"))).toBe(false);
  });
});

describe("resolveAddress — désambiguïsation par attributs (sans géo)", () => {
  it("Bien'ici immeuble 284 m² / 5 lots / E / 2023-10-25 → Pontix (type×surface×lots)", async () => {
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
        propertyType: "Immeuble",
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Pontix");
    expect(res[0]!.status).toBe("confirmed");
  });

  it("Bien'ici appart 46 m² C/127 / 2026-05-12 → Papin (fallback date_visite)", async () => {
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
    expect(res[0]!.status).toBe("confirmed");
    const spine = res[0]!.matchBreakdown.find((b) => b.criterion === "épine");
    expect(spine?.factors?.find((f) => f.criterion === "dpeDate")?.similarity).toBe(1);
  });
});

describe("resolveAddress — anti-faux-positif (status unresolved)", () => {
  it("maison 228 m² SANS DPE → unresolved (aucun signal discriminant)", async () => {
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
    expect(res[0]!.status).toBe("unresolved");
    expect(res.length).toBeGreaterThan(1); // candidates exposés
  });

  it("immeuble St-Sever D/226/GES C : la date seule ne doit PAS confirmer (cohérence type/surface)", async () => {
    const rows = [
      // « 7 Rue Saint-Jean » : MÊME date que l'annonce mais maison 90 m² (type/surface incohérents)
      row({
        id: "SAINTJEAN",
        address: "7 Rue Saint-Jean 40500 Saint-Sever",
        geo: "43.757,-0.574",
        surface: 90,
        type: "maison",
        dpe: "A",
        date: "2024-05-28",
      }),
      ...noise(9),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 280,
        dpeKwhM2: 226,
        gesClass: "C",
        dpeDate: "2024-05-28",
        propertyType: "Immeuble",
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).not.toBe("confirmed"); // jamais un faux confirmed
  });

  it("2 adresses au score proche, sans géo → unresolved + candidates[]", async () => {
    const rows = [
      row({ id: "A", address: "1 Rue Jumelle", surface: 50, dpe: "G", date: "2024-01-01" }),
      row({ id: "B", address: "2 Rue Jumelle", surface: 50, dpe: "G", date: "2024-01-01" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40500", surface: 50, dpeClass: "G", dpeDate: "2024-01-01" },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
    expect(res[0]!.flags).toContain("low-margin");
    expect(res.length).toBeGreaterThanOrEqual(2);
  });

  it("retourne [] sans code postal", async () => {
    const res = await resolveAddress({ postalCode: "" });
    expect(res).toEqual([]);
  });
});
