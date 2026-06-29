import type { Listing, MatchBreakdownItem, ResolvedAddress } from "@empir/core";
import type { AnalyzeDebug } from "@/lib/hooks/use-analyze";

interface DiagnosticPanelProps {
  listing: Listing;
  resolvedAddress?: ResolvedAddress;
  candidates?: ResolvedAddress[];
  debug?: AnalyzeDebug;
}

/** Champs de l'entrée résolveur affichés, dans l'ordre du scoring. */
const INPUT_FIELDS: { key: string; label: string }[] = [
  { key: "postalCode", label: "Code postal" },
  { key: "city", label: "Ville" },
  { key: "propertyType", label: "Type" },
  { key: "surface", label: "Surface (m²)" },
  { key: "landSurface", label: "Terrain (m²)" },
  { key: "dpeKwhM2", label: "DPE kWh/m²" },
  { key: "dpeClass", label: "DPE lettre" },
  { key: "gesKgCO2M2", label: "GES kg CO₂" },
  { key: "gesClass", label: "GES lettre" },
  { key: "yearBuilt", label: "Année constr." },
  { key: "dpeDate", label: "Date DPE" },
  { key: "rooms", label: "Pièces" },
];

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px]">
      <span className="text-[10px] text-empir-muted-2">{label}</span>
      <span className={`text-[11px] tabular-nums ${muted ? "text-empir-muted-2" : "text-empir-text"}`}>
        {value}
      </span>
    </div>
  );
}

function BreakdownTable({
  items,
  expectedByCriterion,
}: {
  items: MatchBreakdownItem[];
  expectedByCriterion: Record<string, unknown>;
}) {
  if (!items.length) {
    return <div className="text-[10px] text-empir-muted-2">Aucun critère évaluable.</div>;
  }
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="text-empir-muted-2">
          <th className="py-[2px] pr-2 text-left font-medium">Critère</th>
          <th className="py-[2px] pr-2 text-right font-medium">Annonce</th>
          <th className="py-[2px] pr-2 text-right font-medium">Cert.</th>
          <th className="py-[2px] pr-2 text-right font-medium" title="sélectivité locale">sél</th>
          <th className="py-[2px] pr-2 text-right font-medium" title="contribution = w·sim·sél">contrib</th>
          <th className="py-[2px] text-center font-medium">✓</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={`${it.criterion}-${i}`} className="border-t border-white/5">
            <td className="py-[2px] pr-2 text-empir-text">{it.criterion}</td>
            <td className="py-[2px] pr-2 text-right text-empir-muted tabular-nums">
              {fmt(it.expected ?? expectedByCriterion[it.criterion])}
            </td>
            <td className="py-[2px] pr-2 text-right text-empir-muted tabular-nums">{fmt(it.actual)}</td>
            <td className="py-[2px] pr-2 text-right text-empir-muted-2 tabular-nums">{fmt(it.selectivity)}</td>
            <td
              className={`py-[2px] pr-2 text-right tabular-nums ${(it.contribution ?? 0) > 0 ? "text-empir-accent" : "text-empir-muted-2"}`}
            >
              {fmt(it.contribution)}
            </td>
            <td className="py-[2px] text-center">
              <span className={it.matched ? "text-emerald-400" : "text-rose-400"}>
                {it.matched ? "✓" : it.similarity != null && it.similarity > 0 ? "≈" : "✗"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Tiroir de diagnostic (mode dev) : affiche les valeurs extraites de l'annonce
 * envoyées au résolveur, les stats ADEME, et chaque candidat avec le détail du
 * scoring (critère, attendu vs trouvé, matché). Flotte au-dessus de la vue
 * résultat sans en modifier la mise en page.
 */
export function DiagnosticPanel({
  listing,
  resolvedAddress,
  candidates,
  debug,
}: DiagnosticPanelProps) {
  const list = candidates ?? (resolvedAddress ? [resolvedAddress] : []);
  const cache = debug?.fromCache;

  // Valeurs extraites reconstruites côté client depuis le `listing` (toujours
  // dispo, sans déploiement). On complète avec ce que la fonction `analyze`
  // renvoie dans `debug.resolverInput` (ex. `yearBuilt`, calculé côté serveur).
  const localInput: Record<string, unknown> = {
    postalCode: listing.location.postalCode,
    city: listing.location.city,
    propertyType: listing.propertyType,
    surface: listing.surface,
    landSurface: listing.landSurface,
    dpeKwhM2: listing.dpeKwhM2,
    dpeClass: listing.dpe,
    gesKgCO2M2: listing.gesKgCO2M2,
    gesClass: listing.ges,
    dpeDate: listing.dpeDate,
    rooms: listing.rooms,
  };
  const serverInput = (debug?.resolverInput ?? {}) as Record<string, unknown>;
  const valueFor = (key: string) => serverInput[key] ?? localInput[key];

  // Valeur « annonce » par critère du scoring — sert à remplir la colonne
  // Annonce du breakdown même quand la fonction déployée ne renvoie pas encore
  // `expected`. (La colonne Certificat, elle, dépend du redéploiement.)
  const expectedByCriterion: Record<string, unknown> = {
    surface: listing.surface,
    dpeKwhM2: listing.dpeKwhM2,
    dpeClass: listing.dpe,
    gesKgCO2M2: listing.gesKgCO2M2,
    gesClass: listing.ges,
    landSurface: listing.landSurface,
    dpeDate: listing.dpeDate,
    buildingType: listing.propertyType,
    yearBuilt: serverInput.yearBuilt,
  };

  return (
    <details className="fixed inset-x-0 bottom-0 z-50 max-h-[72vh] overflow-auto border-t border-white/15 bg-black/95 px-3 pb-4 text-empir-text shadow-[0_-8px_24px_rgba(0,0,0,0.5)] backdrop-blur">
      <summary className="sticky top-0 -mx-3 cursor-pointer list-none bg-black/95 px-3 py-2 text-[11px] font-semibold tracking-wide text-empir-accent select-none">
        🔍 Diagnostic résolution {list.length > 0 ? `· ${list.length} candidat(s)` : ""}
        {cache ? " · (cache)" : ""}
      </summary>

      {/* Valeurs extraites de l'annonce */}
      <section className="mt-2 rounded-[8px] border border-white/10 p-2">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-empir-muted-2">
          Valeurs extraites → résolveur
        </div>
        {INPUT_FIELDS.map((f) => (
          <Row key={f.key} label={f.label} value={fmt(valueFor(f.key))} />
        ))}
      </section>

      {/* Stats ADEME */}
      <section className="mt-2 rounded-[8px] border border-white/10 p-2">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-empir-muted-2">
          Base ADEME
        </div>
        {cache ? (
          <Row label="Source" value="cache (algo non rejoué)" muted />
        ) : (
          <>
            <Row label="Certificats CP" value={fmt(debug?.ademeTotal)} />
            <Row label="Vivier après gate géo" value={fmt(debug?.keptAfterSurfaceFilter)} />
            <Row label="Gate géo précis" value={debug?.usedLandSurfacePass ? "oui" : "non"} />
          </>
        )}
      </section>

      {/* Candidats */}
      <section className="mt-2 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-empir-muted-2">
          Candidats classés
        </div>
        {list.length === 0 && (
          <div className="rounded-[8px] border border-white/10 p-2 text-[11px] text-empir-muted">
            Aucun candidat — vérifie le code postal et la surface (filtre ±15%).
          </div>
        )}
        {list.map((c, i) => (
          <div
            key={c.ademeCertId ?? i}
            className={`rounded-[8px] border p-2 ${
              i === 0 ? "border-empir-accent/40 bg-empir-accent/5" : "border-white/10"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-empir-text">
                #{i + 1} · {c.address || "(adresse vide)"}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {i === 0 && (
                  <span
                    className={`rounded-empir-pill px-[5px] py-[1px] text-[8px] font-bold ${
                      c.resolved
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {c.resolved ? "RÉSOLU" : "NON RÉSOLU"}
                  </span>
                )}
                <span className="text-[11px] font-bold tabular-nums text-empir-accent">
                  {Math.round(c.confidence)}%
                </span>
              </span>
            </div>
            <div className="mb-1 mt-[2px] flex flex-wrap items-center gap-x-3 gap-y-[2px] text-[9px] text-empir-muted-2">
              {c.ademeCertId && <span>DPE {c.ademeCertId}</span>}
              {c.parcelId && <span>Cadastre {c.parcelId}</span>}
              {c.distanceM != null && (
                <span className={c.distanceM <= 25 ? "text-emerald-400" : ""}>
                  📍 {c.distanceM} m
                </span>
              )}
              <span>
                {c.lat?.toFixed(5)}, {c.lon?.toFixed(5)}
              </span>
              {c.flags?.map((f) => (
                <span
                  key={f}
                  className={`rounded-[4px] px-[4px] py-[1px] ${
                    f === "conflict" ? "bg-rose-500/15 text-rose-400" : "bg-white/8 text-empir-muted"
                  }`}
                >
                  {f}
                </span>
              ))}
            </div>
            <BreakdownTable
              items={c.matchBreakdown ?? []}
              expectedByCriterion={expectedByCriterion}
            />
          </div>
        ))}
      </section>

      <div className="mt-3 text-[9px] leading-snug text-empir-muted-2">
        Astuce : si « Annonce » est vide pour DPE/GES, l'annonce n'expose pas le
        chiffre (parser). Si le bon certificat n'apparaît pas, il est soit absent
        de la réponse ADEME (code postal), soit écarté par le filtre surface.
        Les colonnes attendu/trouvé nécessitent la fonction `resolve-address`
        redéployée.
      </div>
    </details>
  );
}
