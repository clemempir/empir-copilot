// Rejoue le corpus de régression et affiche statut + confiance de chaque cas.
// Usage : npx tsx collector/replay-corpus.mts
// (complète `pnpm test:corpus`, qui vérifie mais n'affiche pas les confiances)
import { CASES } from "../packages/core/src/resolver/__corpus.cases.ts";
import { resolveAddress } from "../packages/core/src/resolver/index.ts";

let ok = 0;
for (const c of CASES) {
  const res = await resolveAddress(c.input, { withCadastre: false });
  const top = res[0];
  const statusOk = top?.status === c.expect.status;
  const addrOk = !c.expect.addressIncludes || (top?.address ?? "").includes(c.expect.addressIncludes);
  const flagOk = !c.expect.flag || (top?.flags ?? []).includes(c.expect.flag);
  const pass = statusOk && addrOk && flagOk;
  if (pass) ok++;
  console.log(
    `${pass ? "✓" : "✗"} ${top?.status ?? "aucun"} ${String(Math.round(top?.confidence ?? 0)).padStart(3)}% [${(top?.flags ?? []).join(",")}] ${c.name.slice(0, 70)}`,
  );
  if (!pass) {
    console.log(`    attendu: ${c.expect.status} ${c.expect.addressIncludes ?? ""} ${c.expect.flag ?? ""}`);
    console.log(`    obtenu : ${top?.address ?? "—"}`);
  }
}
console.log(`\n${ok}/${CASES.length} cas conformes`);
