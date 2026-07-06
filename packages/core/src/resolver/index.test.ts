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

  it("conso identique mais surface 90 vs 63 (>1,4×) → conflit (autre logement, pas de faux confirmed)", async () => {
    const rows = [
      row({ id: "PETIT", address: "1 Impasse Petit", geo: "43.898,-0.500", surface: 63, type: "appartement", dpe: "A", kwh: 42, gesClass: "A", ges: 1 }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40000", surface: 90, dpeClass: "B", dpeKwhM2: 43, gesClass: "B", gesKgCO2M2: 7, propertyType: "Appartement", geo: { lat: 43.898, lon: -0.5, radiusM: 780 } },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
  });

  it("même conso mais GES A vs C (2 classes) → conflit (électrique ≠ gaz, biens différents)", async () => {
    const rows = [
      row({ id: "GAZ", address: "105 Rue Gaz", geo: "44.45,1.43", surface: 271, type: "maison", dpe: "C", kwh: 141, gesClass: "C" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "46000", surface: 300, dpeClass: "C", dpeKwhM2: 138, gesClass: "A", propertyType: "Maison", geo: { lat: 44.45, lon: 1.43, radiusM: 6184 } },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
  });

  it("immeuble 500 m² vs studio 19 m² même DPE → conflit de surface (pas de faux confirmed)", async () => {
    // Écart de surface grossier (26×) : un immeuble ne se confirme pas comme un
    // studio qui partage sa classe/conso DPE.
    const rows = [
      row({ id: "STUDIO", address: "10 Rue Studio", geo: "43.888,-0.505", surface: 19, type: "appartement", dpe: "F", kwh: 388, gesClass: "D" }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      { postalCode: "40000", surface: 500, dpeClass: "F", dpeKwhM2: 388, gesClass: "D", propertyType: "Immeuble", geo: { lat: 43.888, lon: -0.505, radiusM: 779 } },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
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

  it("empreinte date DPE : date exacte unique + classe concordante → probable, MÊME hors du disque géo", async () => {
    // Cas réel (Bien'ici 519553460, verdict console) : le disque de 500 m est
    // centré à ~1,4 km du bien — le gate géo exclut le bon cert. La date de
    // diagnostic exacte (quasi-clé : ~2 certs/date/commune) + classe + GES
    // concordants le retrouvent hors gate.
    const rows = [
      // Le bon cert : loin du marqueur (~2 km), date + classe + GES concordent.
      row({
        id: "TRUE",
        address: "404 Chemin Larron 40500 Saint-Sever",
        geo: "43.7300,-0.5300",
        surface: 186,
        type: "maison",
        dpe: "B",
        kwh: 100.5,
        gesClass: "A",
        date: "2023-11-15",
      }),
      // Même date mais TYPE incompatible (immeuble annoncé ≠ maison) — piège
      // documenté : la date seule ne doit pas suffire.
      row({
        id: "TRAP",
        address: "7 Rue du Piège 40500 Saint-Sever",
        geo: "43.7310,-0.5310",
        surface: 357,
        type: "maison",
        dpe: "E",
        kwh: 285,
        date: "2023-11-15",
      }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 166,
        dpeClass: "B",
        dpeKwhM2: 110,
        gesClass: "A",
        gesKgCO2M2: 3,
        dpeDate: "2023-11-15",
        propertyType: "Maison",
        geo: { lat: 43.74296, lon: -0.55421, radiusM: 500 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Larron");
    expect(res[0]!.status).toBe("probable");
    expect(res[0]!.flags).toContain("dpe-date-fingerprint");
    expect(res[0]!.confidence).toBeGreaterThan(75);
  });

  it("empreinte date DPE : type contradictoire toléré si la conso est quasi exacte (erreur d'étiquetage)", async () => {
    // Cas réel (Bien'ici 030055401) : cert « appartement » de 205 m² = la maison
    // annoncée — date, conso (280 ↔ 280,1), GES et surface concordent.
    const rows = [
      row({
        id: "MISLABEL",
        address: "4 Rue Agnoutine 40500 Saint-Sever",
        geo: "43.7600,-0.5760",
        surface: 205,
        type: "appartement", // étiquetage erroné du diagnostiqueur
        dpe: "E",
        kwh: 280.1,
        gesClass: "B",
        ges: 10,
        date: "2024-11-28",
      }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 209,
        dpeClass: "E",
        dpeKwhM2: 280,
        gesClass: "B",
        gesKgCO2M2: 10,
        dpeDate: "2024-11-28",
        propertyType: "Maison",
        geo: { lat: 43.76319, lon: -0.57466, radiusM: 500 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.address).toContain("Agnoutine");
    expect(res[0]!.status).toBe("probable");
    expect(res[0]!.flags).toContain("dpe-date-fingerprint");
  });

  it("empreinte date DPE : type contradictoire SANS conso quasi exacte → toujours rejeté", async () => {
    // Le piège historique (date seule → mauvaise maison) ne doit pas revenir :
    // conso discordante (226 vs 285) + type incompatible = pas d'empreinte.
    const rows = [
      row({
        id: "TRAP2",
        address: "7 Rue Saint-Jean 40500 Saint-Sever",
        geo: "43.7590,-0.5740",
        surface: 240,
        type: "maison",
        dpe: "E",
        kwh: 285,
        date: "2024-05-28",
      }),
      ...noise(6),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 234,
        dpeClass: "E",
        dpeKwhM2: 226,
        dpeDate: "2024-05-28",
        propertyType: "Immeuble",
        geo: { lat: 43.7590, lon: -0.5740, radiusM: 500 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.flags ?? []).not.toContain("dpe-date-fingerprint");
  });

  it("empreinte date DPE : deux adresses plausibles à la même date → ambigu, PAS de résolution", async () => {
    const twin = (id: string, addr: string, geo: string) =>
      row({ id, address: addr, geo, surface: 170, type: "maison", dpe: "B", gesClass: "A", date: "2023-11-15" });
    const rows = [
      twin("A", "1 Rue Double 40500 Saint-Sever", "43.7300,-0.5300"),
      twin("B", "2 Rue Sosie 40500 Saint-Sever", "43.7310,-0.5310"),
      ...noise(6),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 166,
        dpeClass: "B",
        dpeDate: "2023-11-15",
        propertyType: "Maison",
        geo: { lat: 43.74296, lon: -0.55421, radiusM: 500 },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
  });

  it("lot-in-building : marqueur SUR un bâtiment discordant → PAS de résolution sur un immeuble voisin", async () => {
    // Cas réel (SeLoger 272186401) : marqueur à 0 m du vrai bâtiment (DPE
    // discordant → conflit), un immeuble concordant à ~60 m. Le repli ne doit
    // pas contredire le marqueur : abstention.
    const rows = [
      // Le bâtiment désigné par le marqueur (~2 m) — signature discordante.
      row({
        id: "PINNED",
        address: "4 Rue Porte Test 40500 Saint-Sever",
        geo: "43.75320,-0.57065",
        surface: 213,
        type: "immeuble",
        dpe: "B",
        kwh: 90,
      }),
      // Immeuble concordant (classe E) à ~60 m — ne doit PAS être promu.
      row({
        id: "NEIGHBOR",
        address: "25 Rue Voisine 40500 Saint-Sever",
        geo: "43.75370,-0.57090",
        surfaceImm: 300,
        surface: 300,
        apts: 8,
        type: "immeuble",
        dpe: "E",
        kwh: 250,
      }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 34,
        dpeClass: "E",
        dpeKwhM2: 250,
        propertyType: "Appartement",
        geo: { lat: 43.75321, lon: -0.57066, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("unresolved");
    expect(res[0]!.flags ?? []).not.toContain("lot-in-building");
  });

  it("sentinelles portail (dpeClass NS, gesClass VI) = DPE ABSENT, pas un conflit", async () => {
    // Bien'ici renvoie « NS » (non soumis) / « VI » (vierge) quand le diagnostic
    // manque. Une classe hors A-G ne doit jamais produire un conflit systématique :
    // marqueur précis + DPE absent → probable (geo-decided), pas unresolved.
    const rows = [
      row({
        id: "SOLO",
        address: "5 Rue du Marqueur 40500 Saint-Sever",
        geo: "43.75320,-0.57065", // ~4 m du marqueur
        surface: 109,
        type: "maison",
        dpe: "D",
        kwh: 210,
      }),
    ];
    const res = await resolveAddress(
      {
        postalCode: "40500",
        surface: 109,
        dpeClass: "NS" as never,
        gesClass: "VI" as never,
        propertyType: "Maison",
        geo: { lat: 43.75323, lon: -0.57068, precise: true },
      },
      { fetchFn: makeFetch(rows) },
    );
    expect(res[0]!.status).toBe("probable");
    expect(res[0]!.flags).toContain("dpe-absent");
    expect(res[0]!.flags).not.toContain("conflict");
  });
});

describe("resolveAddress — détecteur « marqueur centré agence »", () => {
  // Pathologie réelle (Bien'ici 52457328) : le portail épingle la carte sur
  // l'ADRESSE DE L'AGENCE, pas sur le bien (parfois à ~2 km). Sans détecteur,
  // un marqueur « précis » posé sur l'agence peut géo-décider un voisin de
  // l'agence. Avec `agencyGeo` (adresse de l'agence géocodée), le marqueur
  // tombant sur l'agence est neutralisé : les attributs cherchent partout.
  const AGENCY_ROWS = [
    // Voisin de l'agence, PILE sous le marqueur — le piège du géo-decide.
    row({
      id: "TRAP",
      address: "5 Place de l'Agence 40500 Saint-Sever",
      geo: "43.75320,-0.57065",
      surface: 50,
      type: "maison",
      dpe: "G",
    }),
    // Le VRAI bien, à ~1,9 km : conso exacte (empreinte) le distingue.
    row({
      id: "TRUE",
      address: "12 Rue du Vrai Bien 40500 Saint-Sever",
      geo: "43.74000,-0.58500",
      surface: 50,
      type: "maison",
      dpe: "G",
      kwh: 412,
    }),
    ...noise(6),
  ];
  const AGENCY_INPUT = {
    postalCode: "40500",
    surface: 50,
    dpeClass: "G" as const,
    dpeKwhM2: 412,
    propertyType: "Maison" as const,
    geo: { lat: 43.75321, lon: -0.57066, precise: true },
  };

  it("SANS agencyGeo (témoin) : le marqueur piégé désigne le voisin de l'agence", async () => {
    const res = await resolveAddress(AGENCY_INPUT, { fetchFn: makeFetch(AGENCY_ROWS) });
    expect(res[0]!.address).toContain("Place de l'Agence");
  });

  it("marqueur à ~7 m de l'agence géocodée → géo neutralisée, l'empreinte conso retrouve le vrai bien + flag", async () => {
    const res = await resolveAddress(
      { ...AGENCY_INPUT, agencyGeo: { lat: 43.75325, lon: -0.5707 } },
      { fetchFn: makeFetch(AGENCY_ROWS) },
    );
    expect(res[0]!.address).toContain("Vrai Bien");
    expect(res[0]!.flags).toContain("agency-marker-suspect");
    expect(res[0]!.status).not.toBe("unresolved");
  });

  it("agence LOIN du marqueur (~2 km) → comportement géo inchangé, pas de flag", async () => {
    const res = await resolveAddress(
      { ...AGENCY_INPUT, agencyGeo: { lat: 43.7, lon: -0.5 } },
      { fetchFn: makeFetch(AGENCY_ROWS) },
    );
    expect(res[0]!.address).toContain("Place de l'Agence");
    expect(res[0]!.flags ?? []).not.toContain("agency-marker-suspect");
  });

  it("agencyGeo sans marqueur carte → aucun effet", async () => {
    const { geo: _geo, ...noMarker } = AGENCY_INPUT;
    const res = await resolveAddress(
      { ...noMarker, agencyGeo: { lat: 43.75325, lon: -0.5707 } },
      { fetchFn: makeFetch(AGENCY_ROWS) },
    );
    expect(res[0]!.flags ?? []).not.toContain("agency-marker-suspect");
  });
});
