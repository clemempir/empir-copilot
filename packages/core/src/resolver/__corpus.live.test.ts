import { describe, expect, it } from "vitest";
import { resolveAddress } from "./index";
import { CASES } from "./__corpus.cases";

/**
 * CORPUS DE RÉGRESSION — vraies annonces analysées, rejouées contre l'ADEME LIVE.
 * À lancer après chaque changement d'algo :
 *   pnpm test:corpus       (= CORPUS=1 vitest run …__corpus.live.test.ts)
 * Réseau requis → gardé HORS de la CI (skippé si la variable CORPUS est absente).
 * Chaque cas = input réel extrait d'une annonce + résultat attendu.
 */



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
