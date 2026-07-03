import { describe, expect, it } from "vitest";
import { resolveAddress } from "./index";
import type { ResolverInput, ResolveStatus, ResolveFlag } from "./types";

/**
 * CORPUS DE RÉGRESSION — vraies annonces analysées, rejouées contre l'ADEME LIVE.
 * À lancer après chaque changement d'algo :
 *   pnpm test:corpus       (= CORPUS=1 vitest run …__corpus.live.test.ts)
 * Réseau requis → gardé HORS de la CI (skippé si la variable CORPUS est absente).
 * Chaque cas = input réel extrait d'une annonce + résultat attendu.
 */

interface Case {
  name: string;
  input: ResolverInput;
  expect: {
    status: ResolveStatus;
    addressIncludes?: string; // sous-chaîne attendue dans l'adresse du top
    flag?: ResolveFlag; // flag attendu sur le top
  };
}

const CASES: Case[] = [
  {
    name: "Castallet — maison G/C, marqueur précis (SeLoger)",
    input: {
      postalCode: "40500", surface: 50, dpeClass: "G", gesClass: "C",
      propertyType: "Maison", geo: { lat: 43.75323, lon: -0.57068, precise: true },
    },
    expect: { status: "confirmed", addressIncludes: "Castallet", flag: "geo-corroborated" },
  },
  {
    name: "Barbe d'Or — maison E/E, terrain 570, marqueur précis (SeLoger 271888539)",
    input: {
      postalCode: "40000", surface: 72.15, dpeClass: "E", gesClass: "E", landSurface: 570,
      propertyType: "Maison", geo: { lat: 43.90042, lon: -0.47839, precise: true },
    },
    expect: { status: "confirmed", addressIncludes: "Léo Lagrange", flag: "geo-corroborated" },
  },
  {
    name: "Léon Blum — maison F/382, DATE 2026-04-21, sans marqueur (Bien'ici)",
    input: {
      postalCode: "40000", surface: 105, dpeClass: "F", dpeKwhM2: 382, gesClass: "C",
      gesKgCO2M2: 20, propertyType: "Maison", dpeDate: "2026-04-21",
    },
    expect: { status: "confirmed", addressIncludes: "Léon Blum" },
  },
  {
    name: "Rozanoff — appartement 69 E, lot sans DPE, marqueur précis (SeLoger 272199315)",
    input: {
      postalCode: "40000", surface: 69, dpeClass: "E", gesClass: "C",
      propertyType: "Appartement", geo: { lat: 43.89583, lon: -0.50435, precise: true },
    },
    expect: { status: "probable", addressIncludes: "Rozanoff", flag: "lot-in-building" },
  },
  {
    name: "3bis Rue de la Paix — appartement 65/328 E, disque (SeLoger 272572063)",
    input: {
      postalCode: "40000", surface: 65, dpeClass: "E", dpeKwhM2: 328, gesClass: "C",
      gesKgCO2M2: 13, propertyType: "Appartement", geo: { lat: 43.89838, lon: -0.50016, radiusM: 780 },
    },
    expect: { status: "probable", addressIncludes: "Paix", flag: "dpe-fingerprint" },
  },
  {
    name: "Grands Pins — maison 134 D/224 GES B, terrain 3723, disque (scoring attributaire, SeLoger 272533571)",
    input: {
      postalCode: "40000", surface: 134, dpeClass: "D", dpeKwhM2: 224, gesClass: "B", gesKgCO2M2: 8,
      landSurface: 3723, propertyType: "Maison", geo: { lat: 43.90614, lon: -0.52179, radiusM: 2524 },
    },
    expect: { status: "probable", addressIncludes: "Grands Pins" },
  },
  {
    name: "Laubaner — immeuble 370 D/225 GES B, disque (matche l'immeuble 334, SeLoger 256264245)",
    input: {
      postalCode: "40000", surface: 370, dpeClass: "D", dpeKwhM2: 225, gesClass: "B", gesKgCO2M2: 7,
      propertyType: "Immeuble", geo: { lat: 43.89691, lon: -0.4916, radiusM: 995 },
    },
    expect: { status: "probable", addressIncludes: "Laubaner" },
  },
  {
    name: "CAHORS Muguet — maison 271 C/150 GES C, disque (cross-ville 46000, SeLoger 272541179)",
    input: {
      postalCode: "46000", surface: 271, dpeClass: "C", dpeKwhM2: 150, gesClass: "C", gesKgCO2M2: 23,
      propertyType: "Maison", geo: { lat: 44.45852, lon: 1.44549, radiusM: 1005 },
    },
    expect: { status: "probable", addressIncludes: "Muguet" },
  },
  {
    name: "Saint-Médard — maison 98 m² SANS DPE, marqueur précis → bonne adresse mais probable (pas de DPE pour corroborer) (SeLoger 271492753)",
    input: {
      postalCode: "40000", surface: 98, landSurface: 457, propertyType: "Maison",
      geo: { lat: 43.89729, lon: -0.48754, precise: true },
    },
    expect: { status: "probable", addressIncludes: "Saint-médard" },
  },
  {
    name: "Chemin du Larron — maison 166 B/110 GES A/3, DISQUE FAUX (500 m à ~1,4 km du bien) : retrouvée par l'empreinte date DPE 2023-11-15 hors gate géo (Bien'ici 519553460, verdict console « fixed » 2026-07-02)",
    input: {
      postalCode: "40500", surface: 166, rooms: 8, dpeClass: "B", dpeKwhM2: 110,
      gesClass: "A", gesKgCO2M2: 3, landSurface: 30775, dpeDate: "2023-11-15",
      propertyType: "Maison", geo: { lat: 43.74296876160631, lon: -0.5542123547193814, radiusM: 500 },
    },
    expect: { status: "probable", addressIncludes: "Larron", flag: "dpe-date-fingerprint" },
  },
  {
    name: "Rue Agnoutine — maison 209 E/280 GES B/10 : cert quasi identique (date+conso+GES+surface) mais étiqueté « appartement » par le diagnostiqueur — la tolérance d'étiquetage le retrouve (Bien'ici 030055401, verdict console « fixed » 2026-07-03)",
    input: {
      postalCode: "40500", surface: 209, rooms: 7, yearBuilt: 1940, dpeClass: "E", dpeKwhM2: 280,
      gesClass: "B", gesKgCO2M2: 10, dpeDate: "2024-11-28", propertyType: "Maison",
      geo: { lat: 43.76319033900501, lon: -0.574667773343479, radiusM: 500 },
    },
    expect: { status: "probable", addressIncludes: "Agnoutine", flag: "dpe-date-fingerprint" },
  },
  {
    name: "Général de Lobit — maison 84 F/395 GES F/79, disque 1203 m : empreinte conso exacte, surface 87,6 ↔ 84 (4 %, sous la tolérance relative) malgré un rival à 395,6 (SeLoger 271183891, verdict console « fixed », parcellai.re le trouvait)",
    input: {
      postalCode: "40000", surface: 84, dpeClass: "F", dpeKwhM2: 395, gesClass: "F", gesKgCO2M2: 79,
      propertyType: "Maison", geo: { lat: 43.896909069767446, lon: -0.4915997674418604, radiusM: 1203 },
    },
    expect: { status: "probable", addressIncludes: "Lobit", flag: "dpe-fingerprint" },
  },
  // ── NÉGATIFS : doivent RESTER unresolved (anti-faux-positif des canaux) ──────
  {
    name: "NÉGATIF Morlanne — « 2 T2 vendus en immeuble 83 m² » D/223 GES B/6, marqueur précis en ÎLOT DENSE (16 à 0 m, 14bis à 4 m, 18 à 6 m — vrai bien au n° 18) : le numéro est indécidable par marqueur, abstention correcte (SeLoger 261837915, console + BAN 2026-07-03)",
    input: {
      postalCode: "40500", surface: 83, dpeClass: "D", dpeKwhM2: 223, gesClass: "B", gesKgCO2M2: 6,
      propertyType: "Immeuble", geo: { lat: 43.762228992345754, lon: -0.5727451639030721, precise: true },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Porte d'Aire — appart 34 E/250, marqueur SUR le 4 Rue Porte d'Aire (0 m, DPE discordant) : le repli lot-in-building ne doit PAS résoudre un immeuble à 60 m (SeLoger 272186401, vraie adresse 4 Rue Porte d'Aire, verdict console « fixed » 2026-07-03)",
    input: {
      postalCode: "40000", surface: 34, dpeClass: "E", dpeKwhM2: 250, gesClass: "B", gesKgCO2M2: 7,
      propertyType: "Appartement", geo: { lat: 43.889936037260206, lon: -0.49789394116909713, precise: true },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Leclerc — maison 104 A/42, marqueur à ~6,7 km : l'empreinte date trouve DEUX maisons jumelles (24d et 26, lotissement diagnostiqué le même jour) → ambiguïté, abstention correcte (Bien'ici 476801858, vraie adresse 24 Av. du Général Leclerc)",
    input: {
      postalCode: "40500", surface: 104, rooms: 5, dpeClass: "A", dpeKwhM2: 42,
      gesClass: "A", gesKgCO2M2: 1, dpeDate: "2025-06-18", propertyType: "Maison",
      geo: { lat: 43.78411062925695, lon: -0.4942946338515174, radiusM: 125 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Marsan — T1 40 C/163 : MARQUEUR PORTAIL ERRONÉ (vraie adresse 10 Av. du Marsan à ~1,9 km du disque — centré agence ?) + DPE du lot absent d'ADEME (2026-06-12 trop récent) → abstention correcte (Bien'ici 52457328, verdict console « fixed »)",
    input: {
      postalCode: "40500", surface: 40, rooms: 2, yearBuilt: 1975, dpeClass: "C", dpeKwhM2: 163,
      gesClass: "B", gesKgCO2M2: 6, dpeDate: "2026-06-12", propertyType: "Appartement",
      geo: { lat: 43.75545981038058, lon: -0.5724427941826754, radiusM: 125 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Castallet 26 — maison 75 m² SANS DPE, disque : vraie adresse (26 Rue du Castallet, verdict console) absente d'ADEME → abstention correcte (Bien'ici 52646091)",
    input: {
      postalCode: "40500", surface: 75, landSurface: 516, yearBuilt: 1935, propertyType: "Maison",
      geo: { lat: 43.75458884339806, lon: -0.5709091640475897, radiusM: 125 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Pontix 23 — maison 140 m² SANS DPE, disque : vraie adresse (23 Rue de Pontix, verdict console) absente d'ADEME → abstention correcte (Bien'ici 52294572)",
    input: {
      postalCode: "40500", surface: 140, rooms: 9, landSurface: 40, propertyType: "Maison",
      geo: { lat: 43.75688193472568, lon: -0.5750419396461732, radiusM: 125 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Argenté — appart 90 B/43 GES B/7, cert conso-proche fait 63 m² GES A (surface >1,4×), pas le même logement (SeLoger 271875149)",
    input: {
      postalCode: "40000", surface: 90, dpeClass: "B", dpeKwhM2: 43, gesClass: "B", gesKgCO2M2: 7,
      propertyType: "Appartement", geo: { lat: 43.89838, lon: -0.50016, radiusM: 780 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Cahors 300 C/138 GES A — cert voisin est GES C (≠2 classes), pas le même bien (SeLoger 257979085)",
    input: {
      postalCode: "46000", surface: 300, dpeClass: "C", dpeKwhM2: 138, gesClass: "A", gesKgCO2M2: 1,
      propertyType: "Maison", geo: { lat: 44.45012, lon: 1.43386, radiusM: 6184 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF immeuble 500 F/388 — 0 immeuble ADEME, ne pas confirmer un studio (SeLoger 267780351)",
    input: {
      postalCode: "40000", surface: 500, dpeClass: "F", dpeKwhM2: 388, gesClass: "D", gesKgCO2M2: 33,
      propertyType: "Immeuble", geo: { lat: 43.88803, lon: -0.5056, radiusM: 779 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Hippodrome — maison 425 m² terrain 3000, sans DPE, disque (mal géolocalisé, SeLoger 240186339)",
    input: {
      postalCode: "40000", surface: 425, landSurface: 3000, propertyType: "Maison",
      geo: { lat: 43.90614, lon: -0.52179, radiusM: 2524 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF Bourg-Neuf — appart 66 D/207 GES B, disque (conso banale, SeLoger 256340921)",
    input: {
      postalCode: "40000", surface: 66, dpeClass: "D", dpeKwhM2: 207, gesClass: "B", gesKgCO2M2: 6,
      propertyType: "Appartement", geo: { lat: 43.89691, lon: -0.4916, radiusM: 995 },
    },
    expect: { status: "unresolved" },
  },
  {
    name: "NÉGATIF St-Jean-d'Août — appart 64 C/158 GES B, disque (conso banale, SeLoger 265268063)",
    input: {
      postalCode: "40000", surface: 64, dpeClass: "C", dpeKwhM2: 158, gesClass: "B", gesKgCO2M2: 6,
      propertyType: "Appartement", geo: { lat: 43.89461, lon: -0.51551, radiusM: 1190 },
    },
    expect: { status: "unresolved" },
  },
];

// Réseau requis → uniquement quand CORPUS=1 (sinon skippé en CI).
describe.runIf(!!process.env.CORPUS)("CORPUS régression (ADEME live)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const res = await resolveAddress(c.input, { withCadastre: false });
      const top = res[0];
      const line = `${top?.status} · ${top?.confidence}% · ${top?.address} · [${(top?.flags ?? []).join(",")}]`;
      console.log(`\n[${c.name}]\n  → ${line}`);
      expect(top, "aucun candidat").toBeDefined();
      expect(top!.status, "statut").toBe(c.expect.status);
      if (c.expect.addressIncludes) expect(top!.address, "adresse").toContain(c.expect.addressIncludes);
      if (c.expect.flag) expect(top!.flags ?? [], "flag").toContain(c.expect.flag);
      // Objectif produit : tout bien résolu affiche un badge de confiance > 75 %.
      if (c.expect.status !== "unresolved") {
        expect(top!.confidence, "confiance affichée").toBeGreaterThan(75);
      }
    }, 40_000);
  }
});
