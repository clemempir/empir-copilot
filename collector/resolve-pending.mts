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

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_KEY");
const REPLAY = process.argv.includes("--replay");
const DELAY_MS = 400; // politesse ADEME/BAN entre deux cas

function env(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ variable d'env manquante: ${k}`);
    process.exit(1);
  }
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function sb(path: string, opts: RequestInit = {}): Promise<Response> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r;
}

// ── Mapping dossier de cas → ResolverInput ──────────────────────────────────

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

const TYPE_MAP: Record<string, ResolverInput["propertyType"]> = {
  maison: "Maison",
  appartement: "Appartement",
  immeuble: "Immeuble",
};

function toInput(x: Extracted): ResolverInput | null {
  if (!x.postalCode) return null;
  const geo =
    x.marker?.lat != null && x.marker?.lon != null
      ? {
          lat: x.marker.lat,
          lon: x.marker.lon,
          radiusM: x.marker.radiusM,
          precise: x.marker.precise === true,
        }
      : undefined;
  return {
    postalCode: x.postalCode,
    city: x.city ?? undefined,
    surface: x.surface ?? undefined,
    rooms: x.rooms ?? undefined,
    landSurface: x.landSurface ?? undefined,
    yearBuilt: x.year ?? undefined,
    dpeClass: (x.dpeClass as ResolverInput["dpeClass"]) ?? undefined,
    dpeKwhM2: x.dpeKwh ?? undefined,
    gesClass: (x.gesClass as ResolverInput["gesClass"]) ?? undefined,
    gesKgCO2M2: x.gesVal ?? undefined,
    dpeDate: x.dpeDate ?? undefined,
    propertyType: x.propertyType ? TYPE_MAP[x.propertyType] : undefined,
    geo,
  };
}

/** Code postal d'une commune nommée (même département que la commune déclarée). */
async function postalCodeOf(city: string, declaredPostal: string): Promise<string | null> {
  try {
    const dept = declaredPostal.slice(0, 2);
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(city)}&codeDepartement=${dept}&fields=nom,codesPostaux&boost=population&limit=1`,
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as { nom?: string; codesPostaux?: string[] }[];
    return rows[0]?.codesPostaux?.[0] ?? null;
  } catch {
    return null;
  }
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
          const cp = doubt.postalCode ?? (await postalCodeOf(doubt.city, input.postalCode));
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
          candidates: candidates.map((c) => ({
            address: c.address,
            confidence: c.confidence,
            numero_dpe: c.ademeCertId,
            dist_m: c.distanceM ?? null,
          })),
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
    console.log(`  [${i + 1}/${rows.length}] ${row.id} → ${st}${(patch as { resolved?: { address?: string } }).resolved?.address ? ` · ${(patch as { resolved: { address: string } }).resolved.address}` : ""}`);
    await sleep(DELAY_MS);
  }

  console.log(`\n✓ Terminé — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "rien à faire"}`);
}

run().catch((e) => {
  console.error("✗ Échec:", e);
  process.exit(1);
});
