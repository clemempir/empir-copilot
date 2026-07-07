// Compare la résolution LOCALE (packages/core) et la PROD déployée
// (fonction resolve-address) sur un échantillon du corpus — doit être
// identique depuis la déduplication. Usage : npx tsx collector/compare-prod.mts
import { CASES } from "../packages/core/src/resolver/__corpus.cases.ts";
import { resolveAddress } from "../packages/core/src/resolver/index.ts";

const SB_URL = "https://coqvobufxwurgrsphhnq.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcXZvYnVmeHd1cmdyc3BoaG5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjg3NTksImV4cCI6MjA5Nzk0NDc1OX0.x11asOcuRZoG-xu0OlqnrWftM4MIMNansm6hhV_J9p4";

// Échantillon : 3 positifs (dont empreintes) + 2 négatifs + le cas ORPI.
const SAMPLE = [0, 2, 11, 12, 13, 21].map((i) => CASES[i]!);

let ok = 0;
for (const c of SAMPLE) {
  const local = (await resolveAddress(c.input, { withCadastre: false }))[0];
  const res = await fetch(`${SB_URL}/functions/v1/resolve-address`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" },
    body: JSON.stringify({
      deviceHash: `compare-prod-${Date.now()}`,
      listingUrl: "https://exemple.test/compare",
      input: c.input,
    }),
  });
  const prod = ((await res.json()) as { candidates?: { status?: string; confidence?: number; address?: string }[] })
    .candidates?.[0];
  const same =
    (local?.status ?? "aucun") === (prod?.status ?? "aucun") &&
    Math.round(local?.confidence ?? 0) === Math.round(prod?.confidence ?? 0) &&
    (local?.address ?? "") === (prod?.address ?? "");
  if (same) ok++;
  console.log(
    `${same ? "✓" : "✗"} ${c.name.slice(0, 55)}\n    local: ${local?.status} ${Math.round(local?.confidence ?? 0)}% ${local?.address ?? "—"}\n    prod : ${prod?.status} ${Math.round(prod?.confidence ?? 0)}% ${prod?.address ?? "—"}`,
  );
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`\n${ok}/${SAMPLE.length} identiques local ↔ prod`);
