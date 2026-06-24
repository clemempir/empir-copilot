import { Copy, ExternalLink, Heart } from "lucide-react";
import type { Listing, QuickAnalysis } from "@empir/core";
import type { ResolvedAddress } from "@empir/core";
import {
  ComparablePriceCard,
  ConfidencePill,
  DataRow,
  DpeBars,
  EmpirLogo,
  RiskRow,
  type RiskLevel,
  SalesTimeline,
  ScoreGauge,
  UrbanismeCard,
} from "@/components/empir";

export interface ResultViewProps {
  listing: Listing;
  quick: QuickAnalysis;
  resolvedAddress?: ResolvedAddress;
  comparablesMeta?: string;
  /** Tableau de risques (label + niveau). */
  risks?: { label: string; level: RiskLevel; statusLabel?: string }[];
  /** Zones d'urbanisme. */
  urbanisme?: { zone: string; subtitle?: string; description?: string; tone?: "default" | "warn" | "info" }[];
  /** Ventes DVF historiques pour le timeline. */
  salesHistory?: { year: number; price: number }[];
  /** Usage counter ("3 / 15 ce mois-ci"). */
  usage?: { used: number; limit: number };
  onSaveClick: () => void;
  onAccountClick: () => void;
  saved?: boolean;
}

const fmtEur = (n: number) => `${n.toLocaleString("fr-FR")} €`;

export function ResultView({
  listing,
  quick,
  resolvedAddress,
  comparablesMeta,
  risks = [],
  urbanisme = [],
  salesHistory = [],
  usage,
  onSaveClick,
  onAccountClick,
  saved,
}: ResultViewProps) {
  const address = resolvedAddress?.address ?? listing.location.rawAddress;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-empir-line px-4 py-3">
        <EmpirLogo size="sm" />
        <div className="flex items-center gap-2">
          {usage && (
            <span className="text-[10.5px] text-empir-muted-2 tabular-nums">
              {usage.used}/{usage.limit} ce mois-ci
            </span>
          )}
          <button
            type="button"
            onClick={onAccountClick}
            className="size-7 rounded-empir-pill bg-gradient-to-br from-empir-primary to-empir-primary-dark text-[11px] font-semibold text-white"
            aria-label="Mon compte"
          >
            E
          </button>
        </div>
      </header>

      <div className="empir-scroll flex-1 overflow-y-auto px-4 py-4">
        {/* Hero */}
        <section className="flex items-start gap-4 rounded-empir-card-lg border border-empir-line bg-empir-card p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-empir-muted-2">
              {listing.propertyType ?? "Bien immobilier"}
            </div>
            <h1 className="mt-1 line-clamp-2 text-[15.5px] font-semibold leading-tight text-empir-text">
              {listing.title}
            </h1>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(address).catch(() => {})}
              className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-empir-muted hover:text-empir-text"
              title="Copier l'adresse"
            >
              <Copy className="size-3" />
              <span className="truncate">{address}</span>
            </button>
            <div className="mt-2 flex items-center gap-2 text-[10.5px] text-empir-muted-2">
              <a href={listing.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-empir-accent">
                <ExternalLink className="size-3" />
                {new URL(listing.url).hostname}
              </a>
              <span>·</span>
              <span className="tabular-nums">{fmtEur(listing.price)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={onSaveClick}
              className="grid size-8 place-items-center rounded-empir-pill border border-empir-line bg-empir-card hover:bg-white/10"
              aria-label={saved ? "Retirer des biens sauvegardés" : "Sauvegarder l'annonce"}
            >
              <Heart
                className={
                  saved
                    ? "size-4 fill-empir-danger text-empir-danger"
                    : "size-4 text-empir-muted"
                }
              />
            </button>
            <ScoreGauge score={quick.score} size={88} stroke={7} />
            {resolvedAddress && <ConfidencePill value={resolvedAddress.confidence} />}
          </div>
        </section>

        {/* Caractéristiques */}
        <section className="mt-4 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
          <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
            Caractéristiques
          </h3>
          <div className="mt-1">
            {listing.surface != null && (
              <DataRow label="Surface" value={`${listing.surface} m²`} />
            )}
            {listing.rooms != null && (
              <DataRow label="Pièces" value={`${listing.rooms} pièces`} />
            )}
            {listing.bedrooms != null && (
              <DataRow label="Chambres" value={`${listing.bedrooms} chambres`} />
            )}
            {listing.landSurface != null && (
              <DataRow label="Terrain" value={`${listing.landSurface} m²`} />
            )}
            {listing.dpe && <DataRow label="DPE annoncé" value={listing.dpe} />}
          </div>
        </section>

        {/* Prix comparables */}
        {quick.market && (
          <section className="mt-4">
            <ComparablePriceCard
              medianPpm2={quick.market.medianPricePerM2}
              gapPct={quick.marketGapPct}
              meta={
                comparablesMeta ??
                `${quick.market.sampleSize} ventes · rayon ${Math.round(quick.market.radiusM)} m${
                  quick.market.windowMonths ? ` · ${quick.market.windowMonths} derniers mois` : ""
                }${quick.market.p25PricePerM2 && quick.market.p75PricePerM2 ? ` · P25-P75 ${quick.market.p25PricePerM2}-${quick.market.p75PricePerM2} €/m²` : ""}`
              }
            />
          </section>
        )}

        {/* DPE vérifié */}
        {resolvedAddress?.verifiedDpe && (
          <section className="mt-4 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
            <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
              DPE vérifié (ADEME)
            </h3>
            <div className="mt-3">
              <DpeBars
                announced={listing.dpe?.toUpperCase() as "A" | undefined}
                verified={resolvedAddress.verifiedDpe.class}
                note={
                  listing.dpe && resolvedAddress.verifiedDpe.class !== listing.dpe.toUpperCase()
                    ? `Écart d'une classe entre l'annonce et la base ADEME — ${resolvedAddress.verifiedDpe.kwhM2} kWh/m²/an mesurés.`
                    : `${resolvedAddress.verifiedDpe.kwhM2} kWh/m²/an · ${resolvedAddress.verifiedDpe.gesKgCO2M2} kg CO₂/m²/an.`
                }
              />
            </div>
          </section>
        )}

        {/* Risques */}
        {risks.length > 0 && (
          <section className="mt-4 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
            <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
              Risques (Géorisques)
            </h3>
            <div className="mt-1">
              {risks.map((r, i) => (
                <RiskRow key={`${r.label}-${i}`} {...r} />
              ))}
            </div>
          </section>
        )}

        {/* Urbanisme */}
        {urbanisme.length > 0 && (
          <section className="mt-4 space-y-2">
            <h3 className="px-1 text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
              Urbanisme (PLU)
            </h3>
            {urbanisme.map((u, i) => (
              <UrbanismeCard key={`${u.zone}-${i}`} {...u} />
            ))}
          </section>
        )}

        {/* Historique ventes */}
        {salesHistory.length >= 2 && (
          <section className="mt-4 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
            <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
              Historique des ventes
            </h3>
            <div className="mt-4">
              <SalesTimeline nodes={salesHistory} />
            </div>
          </section>
        )}

        <footer className="mt-6 text-center text-[9.5px] text-empir-muted-2">
          EMPIR · v0.1.0 · données ADEME, DVF, BAN, Géorisques, IGN, geo.api.gouv.fr
        </footer>
      </div>
    </div>
  );
}
