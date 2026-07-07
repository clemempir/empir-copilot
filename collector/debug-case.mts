// Rejeu ponctuel d'un cas réel (debug) : lance avec `npx tsx collector/debug-case.mts`
import { resolveAddress, type ResolverInput } from "../packages/core/src/resolver/index.ts";

// https://www.leboncoin.fr/ad/ventes_immobilieres/3195763796
// Maison de ville, ORPI Saint-Sever — attendu : le 1er rapprochement est la bonne adresse.
const input: ResolverInput = {
  postalCode: "40500",
  city: "Saint-Sever",
  surface: 161,
  rooms: 5,
  landSurface: 414,
  dpeClass: "E",
  dpeKwhM2: 301,
  gesClass: "E",
  gesKgCO2M2: 58,
  propertyType: "Maison",
  geo: { lat: 43.758358, lon: -0.56997585, radiusM: 2500, precision: "disk" },
};

const candidates = await resolveAddress(input, { withCadastre: true });
for (const c of candidates.slice(0, 5)) {
  console.log(
    `${c.status.padEnd(11)} ${String(Math.round(c.confidence)).padStart(3)}%  ${c.address}  [${(c.flags ?? []).join(",")}]  dist=${c.distanceM ?? "?"}m`,
  );
  for (const b of c.matchBreakdown) {
    console.log(`    ${b.matched ? "✓" : "✗"} ${b.criterion}: attendu ${b.expected} / trouvé ${b.actual}`);
  }
}
if (!candidates.length) console.log("aucun candidat");
