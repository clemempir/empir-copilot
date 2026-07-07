// ============================================================================
// EMPIR — Résolution locale des cas collectés (boucle d'amélioration)
// ----------------------------------------------------------------------------
// Lit les cas de la table `cases` (Supabase), résout chaque adresse avec
// l'algo LOCAL (packages/core — la version du repo, pas celle déployée),
// puis écrit le résultat dans le dossier de cas.
//
// Usage :
//   pnpm resolve-pending              # résout les cas `pending_resolution`
//   pnpm resolve-pending --replay     # re-résout TOUS les cas (après un
//                                     # changement d'algo, pour re-mesurer)
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================================
import { execSync } from "node:child_process";
import { resolveAddress, type ResolverInput } from "../packages/core/src/resolver/index.ts";
import { detectCommuneDoubt } from "../packages/core/src/extraction/commune-doubt.ts";
import { postalCodeOfCity } from "../packages/core/src/enrichment/commune.ts";
// @ts-expect-error module JS partagé sans déclarations de types
import { sb, sleep, toResolverInput, toCandidateRow } from "./_shared.mjs";

const REPLAY = process.argv.includes("--replay");
const DELAY_MS = 400; // politesse ADEME/BAN entre deux cas

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// ── Mapping dossier de cas → ResolverInput (partagé, cf. _shared.mjs) ────────

interface Extracted {
  description?: string | null;
  propertyType?: string;
  surface?: number | null;
  rooms?: number | null;
  landSurface?: number | null;
  dpeClass?: string | null;
  dpeKwh?: number | null;
  gesClass?: string | null;
  gesVal?: number | null;
  dpeDate?: string | null;
  year?: number | null;
  city?: string | null;
  postalCode?: string | null;
  marker?: { lat?: number; lon?: number; radiusM?: number; precise?: boolean } | null;
}

function toInput(x: Extracted): ResolverInput | null {
  return toResolverInput(x) as ResolverInput | null;
}

// ── Boucle principale ────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const algoVersion = gitSha();
  const filter = REPLAY
    ? "status=in.(pending_resolution,confirmed,probable,unresolved,error)"
    : "status=eq.pending_resolution";
  const r = await sb(`cases?${filter}&select=id,extracted&order=collected_at.asc&limit=500`);
  const rows = (await r.json()) as { id: string; extracted: Extracted }[];
  console.log(`▶ ${rows.length} cas à résoudre (${REPLAY ? "replay complet" : "en attente"}) — algo ${algoVersion}`);

  const counts: Record<string, number> = {};
  for (const [i, row] of rows.entries()) {
    const input = toInput(row.extracted);
    let patch: Record<string, unknown>;
    if (!input) {
      patch = { status: "error", error: "extracted sans code postal", algo_version: algoVersion };
    } else {
      try {
        // Doute « mauvaise commune » : la description contredit la commune
        // déclarée (agent qui classe le village sur la grande ville).
        const doubt = detectCommuneDoubt(row.extracted.description ?? undefined, row.extracted.city ?? undefined);
        if (doubt?.city) {
          // Commune nommée → on résout dans la BONNE commune.
          const cp = doubt.postalCode ?? (await postalCodeOfCity(doubt.city, input.postalCode));
          if (cp) {
            input.postalCode = cp;
            input.city = doubt.city;
            // Le marqueur pointe la commune déclarée (fausse) → inutilisable.
            input.geo = undefined;
          }
        }
        const candidates = await resolveAddress(input, { withCadastre: true });
        let top = candidates[0];
        if (doubt && !doubt.city && top && top.status !== "unresolved") {
          // Doute sans commune nommée (« à 15 mn de X ») : on n'affirme pas.
          top = { ...top, status: "unresolved", flags: [...(top.flags ?? []), "commune-doubt" as never] };
          candidates[0] = top;
        }
        patch = {
          resolved: top
            ? {
                address: top.address,
                lat: top.lat,
                lon: top.lon,
                confidence: top.confidence,
                status: top.status,
                ademeCertId: top.ademeCertId,
                parcelId: top.parcelId,
                flags: top.flags ?? [],
                communeDoubt: doubt ?? undefined,
                // Commune corrigée par le doute (utile à la console).
                resolvedInCity: doubt?.city ? input.city : undefined,
              }
            : { address: null, confidence: 0, status: "unresolved", communeDoubt: doubt ?? undefined },
          candidates: candidates.map(toCandidateRow),
          score_breakdown: top?.matchBreakdown ?? [],
          status: top?.status ?? "unresolved",
          error: null,
          algo_version: algoVersion,
        };
      } catch (e) {
        patch = { status: "error", error: String((e as Error).message ?? e), algo_version: algoVersion };
      }
    }
    await sb(`cases?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const st = String(patch.status);
    counts[st] = (counts[st] ?? 0) + 1;
    const addr = (patch.resolved as { address?: string } | undefined)?.address;
    console.log(`  [${i + 1}/${rows.length}] ${row.id} → ${st}${addr ? ` · ${addr}` : ""}`);
    // Politesse ADEME/BAN : uniquement après un cas qui a réellement appelé le
    // résolveur, et pas après le dernier.
    if (input && i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n✓ Terminé — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "rien à faire"}`);
}

run().catch((e) => {
  console.error("✗ Échec:", e);
  process.exit(1);
});
