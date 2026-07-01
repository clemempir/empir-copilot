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
  // ── NÉGATIFS : doivent RESTER unresolved (anti-faux-positif des canaux) ──────
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
    }, 40_000);
  }
});
