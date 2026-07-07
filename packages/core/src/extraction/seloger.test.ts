import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSelogerListingPage, parseSeloger, parseSelogerHtml } from "./seloger.ts";
import { extractSelogerGeo, toPropertyType } from "./mapping.ts";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/seloger-annonce.html"),
  "utf8",
);

function docWith(innerHtml: string): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = innerHtml;
  return doc;
}

function loadDoc(): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = html;
  return doc;
}

const REAL_URL =
  "https://www.seloger.com/annonces/achat/appartement/saint-denis-974/271190031.htm";

describe("isSelogerListingPage", () => {
  it("reconnaît les URLs d'annonces réelles", () => {
    expect(
      isSelogerListingPage(
        "https://www.seloger.com/annonces/achat/appartement/saint-denis-974/271190031.htm",
      ),
    ).toBe(true);
    expect(
      isSelogerListingPage(
        "https://www.seloger.com/annonces/achat-de-prestige/maison/lyon-69/987654321.htm",
      ),
    ).toBe(true);
  });

  it("reconnaît le format /{id}/detail.htm (vue détail SERP)", () => {
    expect(
      isSelogerListingPage(
        "https://www.seloger.com/256068147/detail.htm?serp_view=list&search=distributionTypes%3DBuy#ln=classified_search_results",
      ),
    ).toBe(true);
  });

  it("rejette les pages non-annonces", () => {
    expect(isSelogerListingPage("https://www.seloger.com/immobilier/achat/")).toBe(false);
    expect(isSelogerListingPage("https://www.seloger.com/")).toBe(false);
  });
});

describe("parseSeloger", () => {
  // ── throw-paths ────────────────────────────────────────────────────────────

  it("jette « structure inconnue » quand aucun état embarqué n'est trouvé", () => {
    const doc = docWith("<body><h1>Annonce</h1></body>");
    expect(() => parseSeloger(doc, REAL_URL)).toThrow(/structure inconnue/i);
  });

  it("jette quand le JSON d'état est illisible", () => {
    const doc = docWith(
      `<body><script>window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("{cassé{");</script></body>`,
    );
    expect(() => parseSeloger(doc, REAL_URL)).toThrow(/structure inconnue/i);
  });

  it("jette quand l'état est présent mais sans prix exploitable", () => {
    const noPriceState = {
      app_cldp: {
        data: {
          classified: {
            metadata: {},
            rawData: { propertyTypeLabel: "Appartement" },
            sections: {
              hardFacts: { title: "Appartement" },
              location: { address: { city: "Paris", zipCode: "75001" } },
              description: { description: "Desc" },
              gallery: { images: [] },
              energy: { certificates: [], features: [] },
              features: { preview: [], details: { categories: [] } },
            },
            legacyTracking: { products: [{ price: 0, space: 50, nb_rooms: 3 }] },
          },
        },
      },
    };
    const escaped = JSON.stringify(JSON.stringify(noPriceState));
    const doc = docWith(
      `<body><script>window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${escaped});</script></body>`,
    );
    expect(() => parseSeloger(doc, REAL_URL)).toThrow(/structure inconnue/i);
  });

  // ── surface du terrain (fact plotSpace) ─────────────────────────────────────

  function stateWithFacts(facts: Array<{ type: string; splitValue?: string }>): Document {
    const state = {
      app_cldp: {
        data: {
          classified: {
            metadata: {},
            rawData: { propertyTypeLabel: "Maison" },
            sections: {
              hardFacts: { title: "Maison à vendre", facts },
              location: { address: { city: "Mont-de-Marsan", zipCode: "40000" } },
              description: { description: "Belle maison avec terrain" },
              gallery: { images: [] },
              energy: { certificates: [] },
              features: { details: { categories: [] } },
            },
            legacyTracking: {
              products: [{ price: 459_000, space: 175, nb_rooms: 7, nb_bedrooms: 4 }],
            },
          },
        },
      },
    };
    const escaped = JSON.stringify(JSON.stringify(state));
    return docWith(
      `<body><script>window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${escaped});</script></body>`,
    );
  }

  it("extrait la surface du terrain (fact plotSpace, séparateur de milliers)", () => {
    const doc = stateWithFacts([
      { type: "livingSpace", splitValue: "175" },
      { type: "plotSpace", splitValue: "40 000" },
    ]);
    const listing = parseSeloger(doc, REAL_URL);
    expect(listing.landSurface).toBe(40_000);
    expect(listing.surface).toBe(175);
  });

  it("laisse landSurface indéfini quand aucun fact plotSpace n'est présent", () => {
    const doc = stateWithFacts([{ type: "livingSpace", splitValue: "89" }]);
    const listing = parseSeloger(doc, REAL_URL);
    expect(listing.landSurface).toBeUndefined();
  });

  // ── barèmes énergie (nouveau format efficiencyClass/values) ─────────────────

  function stateWithEnergy(certificates: unknown): Document {
    const state = {
      app_cldp: {
        data: {
          classified: {
            metadata: {},
            rawData: { propertyTypeLabel: "Appartement" },
            sections: {
              hardFacts: { title: "Appartement", facts: [] },
              location: { address: { city: "Saint-Sever", zipCode: "40500" } },
              description: { description: "Appartement mansardé" },
              gallery: { images: [] },
              energy: { certificates },
              features: { details: { categories: [] } },
            },
            legacyTracking: { products: [{ price: 139_560, space: 46, nb_rooms: 3 }] },
          },
        },
      },
    };
    const escaped = JSON.stringify(JSON.stringify(state));
    return docWith(
      `<body><script>window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${escaped});</script></body>`,
    );
  }

  it("extrait lettres ET chiffres DPE/GES du nouveau format (efficiencyClass + values)", () => {
    // Structure réelle SeLoger 2026 : DPE et GES sont deux scales d'un même cert.
    // Le kWh du barème EST la vraie conso du DPE (vérifié sur annonces réelles) —
    // signal discriminant, à distinguer de l'estimation de facture €/an.
    const doc = stateWithEnergy([
      {
        scales: [
          {
            efficiencyClass: { index: 2, rating: "C" },
            values: [
              { value: "127 kWh/m².an", label: "Consommation (énergie primaire)" },
              { value: "4 kg CO₂/m².an", label: "Émissions" },
            ],
          },
          {
            efficiencyClass: { index: 0, rating: "A" },
            values: [{ value: "4 kg CO₂/m².an", label: "Émissions" }],
          },
        ],
      },
    ]);
    const listing = parseSeloger(doc, REAL_URL);
    expect(listing.dpe).toBe("C");
    expect(listing.dpeKwhM2).toBe(127);
    expect(listing.ges).toBe("A");
    expect(listing.gesKgCO2M2).toBe(4);
  });

  // ── fixture réelle ─────────────────────────────────────────────────────────
  // parseSelogerHtml est utilisé pour les tests de fixture car happy-dom peut
  // supprimer les gros scripts inline lors du parsing via innerHTML.

  it("extrait un Listing cohérent depuis la fixture réelle", () => {
    const listing = parseSelogerHtml(html, REAL_URL);
    expect(listing.site).toBe("seloger");
    expect(listing.price).toBe(394_400);
    expect(listing.surface).toBe(89);
    expect(listing.rooms).toBe(4);
    expect(listing.bedrooms).toBe(3);
    expect(listing.location.postalCode).toMatch(/^\d{5}$/);
    expect(listing.location.city).toBe("Saint-Denis");
    expect(listing.location.postalCode).toBe("97400");
    expect(listing.propertyType).toBe("Appartement");
    expect(listing.description.length).toBeGreaterThan(20);
    expect(listing.photos.length).toBeGreaterThan(0);
    expect(listing.attributes).toBeDefined();
    expect(listing.attributes!.length).toBeGreaterThan(0);
    for (const a of listing.attributes!) {
      expect(typeof a.label).toBe("string");
      expect(a.label.length).toBeGreaterThan(0);
      expect(typeof a.value).toBe("string");
    }
  });

  it("snapshot stable (hors extractedAt) sur la fixture réelle", () => {
    const listing = parseSelogerHtml(html, REAL_URL);
    const { extractedAt, ...stable } = listing;
    expect(stable).toMatchSnapshot();
  });
});

describe("géo SeLoger (overlay Mapbox)", () => {
  const saintSever = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/seloger-saint-sever-268828085.html"),
    "utf8",
  );

  it("extrait le centre + rayon du polygone Mapbox", () => {
    const geo = extractSelogerGeo(saintSever);
    expect(geo).toBeDefined();
    expect(geo!.lat).toBeCloseTo(43.76, 1);
    expect(geo!.lon).toBeCloseTo(-0.56, 1);
    // Contour de commune (localisation_city) → grand rayon → disque imprécis,
    // que le résolveur traite comme « pas de marqueur décisif ».
    expect(geo!.radiusM!).toBeGreaterThan(1000);
  });

  it("renvoie undefined sans overlay géo", () => {
    expect(extractSelogerGeo("<html>pas de carte</html>")).toBeUndefined();
  });

  it("lit les lettres DPE/GES depuis le DOM quand l'état ne les porte pas", () => {
    const listing = parseSelogerHtml(saintSever, "https://www.seloger.com/256068147/detail.htm");
    expect(listing.dpe).toBe("D");
    expect(listing.ges).toBe("B");
  });
});

describe("toPropertyType — immeuble", () => {
  it("reconnaît immeuble (titre ou label)", () => {
    expect(toPropertyType("Immeuble à vendre")).toBe("Immeuble");
    expect(toPropertyType("immeuble de rapport")).toBe("Immeuble");
    expect(toPropertyType("Appartement 3 pièces")).toBe("Appartement");
    expect(toPropertyType("Maison à vendre")).toBe("Maison");
  });
});

describe("agence SeLoger (contactSections.provider)", () => {
  const saintSever = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/seloger-saint-sever-268828085.html"),
    "utf8",
  );

  it("extrait nom + adresse de l'agence depuis l'état __UFRN", () => {
    const listing = parseSelogerHtml(saintSever, REAL_URL);
    expect(listing.agencyName).toBe("Zefir");
    expect(listing.agencyAddress).toBe("50 rue taitbout, 75009 Paris");
  });
});
