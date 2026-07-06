import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBienici } from "./bienici";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/bienici-immo-facile-57473578.html"),
  "utf8",
);

function loadDoc(): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = html;
  return doc;
}

function docWith(innerHtml: string): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = innerHtml;
  return doc;
}

const REAL_URL =
  "https://www.bienici.com/annonce/vente/bordeaux/appartement/1piece/immo-facile-57473578";

describe("parseBienici (fixture réelle Bordeaux 57473578)", () => {
  it("extrait titre, prix et image depuis le JSON-LD Product", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.site).toBe("bienici");
    expect(r.title.replace(/ /g, " ")).toBe(
      "Achat appartement 1 pièce 27 m², Bordeaux - 136 370 €",
    );
    expect(r.price).toBe(136370);
    expect(r.photos.length).toBeGreaterThan(0);
    expect(r.photos[0]).toMatch(/file\.bienici\.com\/photo\/immo-facile-57473578/);
  });

  it("extrait surface, pièces, ville et code postal depuis le JSON-LD Accommodation", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.surface).toBeCloseTo(26.58, 2);
    expect(r.rooms).toBe(1);
    expect(r.location.city).toBe("Bordeaux");
    expect(r.location.postalCode).toBe("33000");
    expect(r.location.rawAddress).toBe("Bordeaux 33000");
  });

  it("lit DPE/GES depuis la ligne .active du diagnostic", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.dpe).toBe("E");
    expect(r.ges).toBe("B");
  });

  it("extrait la date du DPE en toutes lettres (« Date de réalisation du DPE : 5 décembre 2024 »)", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.dpeDate).toBe("2024-12-05");
  });

  it("déduit propertyType depuis l'URL", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.propertyType).toBe("Appartement");
  });
});

describe("parseBienici (cas d'erreur)", () => {
  it("jette « structure inconnue » sans JSON-LD Product", () => {
    const doc = docWith("<body><h1>Annonce</h1></body>");
    expect(() => parseBienici(doc, REAL_URL)).toThrow(/structure inconnue/i);
  });

  it("jette quand le JSON-LD Product n'a pas de prix", () => {
    const doc = docWith(
      `<body><script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "Product",
        name: "Sans prix",
      })}</script></body>`,
    );
    expect(() => parseBienici(doc, REAL_URL)).toThrow(/structure inconnue/i);
  });

  it("supporte un prix dans offers.price directement (sans priceSpecification)", () => {
    const doc = docWith(
      `<body><script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "Product",
        name: "Test",
        offers: { "@type": "Offer", price: 250000, priceCurrency: "EUR" },
      })}</script></body>`,
    );
    expect(parseBienici(doc, REAL_URL).price).toBe(250000);
  });

  it("URL /maison/ → propertyType Maison", () => {
    const doc = docWith(
      `<body><script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "Product",
        name: "Maison",
        offers: { priceSpecification: { price: 450000 } },
      })}</script></body>`,
    );
    const url = "https://www.bienici.com/annonce/vente/lyon/maison/5pieces/abc-123";
    expect(parseBienici(doc, url).propertyType).toBe("Maison");
  });
});

describe("agence Bien'ici (bloc « À propos de l'agence »)", () => {
  it("extrait nom + adresse de l'agence (adresse normalisée pour le géocodage BAN)", () => {
    const r = parseBienici(loadDoc(), REAL_URL);
    expect(r.agencyName).toBe("Côté Particuliers Bordeaux Chartrons");
    // « 20 Cr Balguerie Stuttenberg - 33300 Bordeaux » → tiret remplacé par virgule
    expect(r.agencyAddress).toBe("20 Cr Balguerie Stuttenberg, 33300 Bordeaux");
  });

  it("absents quand la page n'a pas de bloc agence", () => {
    const doc = docWith(
      `<script type="application/ld+json">{"@type":"Product","name":"t","offers":{"price":100000}}</script>`,
    );
    const r = parseBienici(doc, REAL_URL);
    expect(r.agencyName).toBeUndefined();
    expect(r.agencyAddress).toBeUndefined();
  });
});
