import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ExternalLink, Heart, MapPin, PencilLine, RotateCw, User } from "lucide-react";
import type { CoproprieteInfo, DpeDetails, GeoPoint, Listing, Parcel, QuickAnalysis } from "@empir/core";
import type { ResolvedAddress } from "@empir/core";
import { cn } from "@/lib/utils";
import { AddressEditor } from "./AddressEditor";
import {
  ComparablePriceCard,
  DataRow,
  DpeBars,
  type DpeClass,
  DpeDetailsCard,
  PROPERTY_VISUALS,
  propertyKind,
  type RiskLevel,
  RiskSummary,
  SalesTimeline,
  ScoreGauge,
  SectionHeader,
  UrbanismeCard,
} from "@/components/empir";

export interface ResultViewProps {
  listing: Listing;
  quick: QuickAnalysis;
  /** Encart affiché au-dessus de la carte adresse (ex. dernière notification). */
  notice?: ReactNode;
  /**
   * Résolution DÉJÀ filtrée par App : pour une adresse affirmée par
   * l'utilisateur, elle ne désigne jamais une autre adresse que celle-ci
   * (garde `sameAddress` côté App, unique pour l'affichage ET les hooks).
   */
  resolvedAddress?: ResolvedAddress;
  /**
   * Parcelle levée directement au point affirmé par l'utilisateur (adresse
   * saisie/corrigée) — affichée quand le résolveur DPE n'apporte pas la sienne.
   */
  parcelFallback?: Parcel | null;
  /** Copropriété (registre RNIC) si la parcelle y figure ; sinon rien d'affiché. */
  copro?: CoproprieteInfo | null;
  /** Détail DPE réel (chauffage/fenêtres/isolation) si le certificat ADEME est connu. */
  dpeDetails?: DpeDetails | null;
  /** Tous les rapprochements d'adresse trouvés par l'algo (liste déroulante). */
  candidates?: ResolvedAddress[];
  /** L'utilisateur valide un rapprochement → il devient l'adresse affirmée. */
  onCandidateValidate?: (candidate: ResolvedAddress) => void;
  comparablesMeta?: string;
  risks?: { label: string; level: RiskLevel; statusLabel?: string }[];
  urbanisme?: {
    zone: string;
    subtitle?: string;
    description?: string;
    tone?: "default" | "warn" | "info";
    statut?: "concerne" | "non-concerne" | "inconnu";
  }[];
  salesHistory?: { year: number; price: number }[];
  /** Résumé d'évolution sous la frise, ex. « +22 % depuis 2021 · +4 %/an ». */
  salesSummary?: string | null;
  /** Notification non lue → pastille rouge sur le bouton compte. */
  hasUnread?: boolean;
  onSaveClick: () => void;
  onAccountClick: () => void;
  /** Relance l'analyse du bien affiché (résultat restauré après changement d'onglet). */
  onReanalyze: () => void;
  saved?: boolean;
  /**
   * Saisie manuelle de l'adresse (relance l'analyse avec l'adresse exacte).
   * Le lien « Je connais l'adresse » n'apparaît que si la localisation n'est
   * pas confirmée (confiance < 75 %) — zéro pollution quand l'algo est sûr.
   */
  onAddressSubmit?: (point: GeoPoint) => void;
}

/** Sous ce seuil, la localisation n'est pas « confirmée » → saisie proposée. */
const CONFIDENCE_CONFIRMED = 75;

const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

function splitAddress(addr: string): { line1: string; line2?: string } {
  const m = addr.match(/^(.*?)(?:\s+)(\d{5}\b.*)$/);
  if (m) return { line1: m[1]!.trim(), line2: m[2]!.trim() };
  return { line1: addr };
}

export function ResultView({
  listing,
  quick,
  notice,
  resolvedAddress: resolved,
  parcelFallback,
  copro,
  dpeDetails,
  candidates = [],
  onCandidateValidate,
  comparablesMeta,
  risks = [],
  urbanisme = [],
  salesHistory = [],
  salesSummary = null,
  hasUnread,
  onSaveClick,
  onAccountClick,
  onReanalyze,
  saved,
  onAddressSubmit,
}: ResultViewProps) {
  const [editingAddress, setEditingAddress] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  // Annonce synthétique du mode manuel : prix/surface inconnus → pas de
  // score prix, pas de sauvegarde (ce n'est pas une annonce).
  const isManual = listing.manual === true;
  // Rapprochements affichables : une adresse concrète, sans doublon.
  const candidateRows = candidates.filter(
    (c, i) => c.address && candidates.findIndex((o) => o.address === c.address) === i,
  );
  // Adresse saisie à la main = vérité : elle reste affichée (App garantit déjà
  // que `resolved` ne désigne jamais une autre adresse que celle-ci).
  const manualAddress = listing.location.locationCorrected
    ? listing.location.rawAddress
    : undefined;
  // `resolvedOk` = ce que l'algo ASSUME (statut ≠ unresolved) : seules ces
  // résolutions alimentent les données vérifiées (surface réelle, DPE réel,
  // cadastre). Un top « unresolved » reste AFFICHÉ comme adresse par défaut
  // (1er rapprochement) mais avec son badge de fiabilité rouge — l'utilisateur
  // voit la meilleure piste et peut la corriger ou la valider.
  const resolvedOk = resolved && resolved.status !== "unresolved" ? resolved : undefined;
  const address =
    manualAddress ?? resolvedOk?.address ?? resolved?.address ?? listing.location.rawAddress ?? "";
  const { line1, line2 } = splitAddress(address);
  // Surface habitable réelle issue du DPE ADEME (colonne « Réel ») — valeur
  // exacte du certificat, à la décimale près (ex. 162,2 m²), pas d'arrondi.
  const realSurface = resolvedOk?.verifiedDpe?.surfaceM2 ?? null;
  // Au moins une caractéristique ANNONCÉE (colonne « Affiché ») : piloté par
  // la présence réelle des champs — pas par le mode — pour qu'une annonce
  // lacunaire (aucun des quatre champs) rende aussi un tableau sans en-tête.
  const hasAnnounced =
    listing.surface != null ||
    listing.landSurface != null ||
    listing.rooms != null ||
    listing.bedrooms != null;
  // Parcelle : celle du résolveur (adresse assumée) d'abord, sinon celle levée
  // au point affirmé par l'utilisateur (mode manuel / adresse corrigée).
  const parcelDisplay = resolvedOk?.parcelId
    ? {
        id: resolvedOk.parcelId,
        section: resolvedOk.parcelSection,
        numero: resolvedOk.parcelNumero,
      }
    : parcelFallback ?? undefined;
  const propVisual = PROPERTY_VISUALS[propertyKind(listing)];
  const mapsHref = address ? mapsUrl(address) : null;
  // Saisie manuelle proposée seulement quand la localisation n'est pas confirmée.
  const canEditAddress =
    !!onAddressSubmit &&
    (!!manualAddress || !resolvedOk || resolvedOk.confidence < CONFIDENCE_CONFIRMED);

  return (
    <div className="flex h-full flex-col">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
        style={{
          background:
            "radial-gradient(120% 80% at 70% -10%, rgba(124,108,255,0.22), transparent 60%)",
        }}
      />

      {/* Sticky header */}
      <header
        className="sticky top-0 z-10 flex items-end justify-between border-b px-[18px] pb-[13px] pt-[22px]"
        style={{
          background: "#0d121d",
          borderBottomColor: "rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-[0.16em] text-empir-text">
            EMPIR Copilot
          </span>
          <span className="mt-1 max-w-[220px] text-[8px] font-semibold uppercase leading-[1.3] tracking-[0.08em] text-empir-muted-2">
            Reprenez le contrôle de l'information
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReanalyze}
            title="Relancer l'analyse"
            className="grid size-8 place-items-center rounded-[9px] transition-all hover:bg-white/5"
          >
            <RotateCw className="size-4 text-empir-muted" strokeWidth={1.8} />
          </button>
          {!isManual && (
            <button
              type="button"
              onClick={onSaveClick}
              title={saved ? "Retirer des biens sauvegardés" : "Sauvegarder l'annonce"}
              className="grid size-8 place-items-center rounded-[9px] transition-all"
              style={{
                background: saved ? "rgba(124,108,255,0.18)" : "transparent",
                border: "none",
              }}
            >
              <Heart
                className="size-4"
                style={{
                  fill: saved ? "#b7acff" : "none",
                  stroke: saved ? "#b7acff" : "#aeb6c5",
                  strokeWidth: 1.8,
                }}
              />
            </button>
          )}
          <button
            type="button"
            onClick={onAccountClick}
            title="Mon compte"
            className="relative grid size-8 place-items-center rounded-[9px] bg-transparent"
          >
            <User className="size-4 text-empir-muted" strokeWidth={1.8} />
            {hasUnread && (
              <span
                className="absolute right-[5px] top-[4px] size-[7px] rounded-full"
                style={{
                  background: "#ff5d73",
                  border: "1.5px solid #0d121d",
                }}
              />
            )}
          </button>
        </div>
      </header>

      <div className="empir-scroll relative flex-1 overflow-y-auto px-[18px] pb-7">
        {/* Encart notification (au-dessus de la carte adresse) */}
        {notice && <div className="mt-[14px]">{notice}</div>}

        {/* ─── HERO ─── */}
        <section
          className="mt-[14px] rounded-[14px] border p-4"
          style={{
            background:
              "linear-gradient(160deg, rgba(30,36,54,0.66), rgba(16,21,33,0.66))",
            borderColor: "rgba(255,255,255,0.07)",
          }}
        >
          <div className="flex items-center gap-[13px]">
            {/* Iso visual */}
            <div className="relative grid size-[98px] shrink-0 place-items-center">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 45%, rgba(124,108,255,0.45), transparent 68%)",
                }}
              />
              <img
                src={propVisual.src}
                alt={propVisual.alt}
                className="relative size-[104px] object-contain"
                style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))" }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-empir-text">
                {isManual ? "Adresse analysée" : propVisual.label}
              </div>
              {editingAddress && onAddressSubmit ? (
                <AddressEditor
                  nearby={
                    listing.geo ??
                    (resolved?.lat ? { lat: resolved.lat, lon: resolved.lon } : undefined)
                  }
                  onCancel={() => setEditingAddress(false)}
                  onSubmit={(point) => {
                    setEditingAddress(false);
                    onAddressSubmit(point);
                  }}
                />
              ) : (
                <>
                  <div className="mt-2 flex items-start gap-[5px]">
                    <MapPin
                      className="mt-[1px] size-[11px] shrink-0 text-empir-muted-2"
                      strokeWidth={1.8}
                    />
                    <div className="min-w-0 flex-1 text-[10px] leading-[1.4] text-empir-muted">
                      {line1}
                      {line2 && (
                        <>
                          <br />
                          <span className="text-empir-muted-2">{line2}</span>
                        </>
                      )}
                    </div>
                    {mapsHref && (
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noreferrer"
                        title="Ouvrir dans Google Maps"
                        className="grid size-[22px] shrink-0 place-items-center rounded-[6px] transition-all hover:bg-white/10"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      >
                        <ExternalLink
                          className="size-3 text-empir-muted"
                          strokeWidth={1.8}
                        />
                      </a>
                    )}
                  </div>
                  {(resolved || manualAddress || canEditAddress) && (
                    <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
                      {manualAddress ? (
                        <span
                          className="rounded-empir-pill px-[7px] py-[2px] text-[10px] font-bold"
                          style={{ background: "rgba(96,165,250,0.14)", color: "#60a5fa" }}
                        >
                          adresse saisie
                        </span>
                      ) : resolved ? (
                        <>
                          <span
                            className="rounded-empir-pill px-[7px] py-[2px] text-[10px] font-bold"
                            style={
                              resolved.confidence < 60
                                ? { background: "rgba(239,68,68,0.14)", color: "#f87171" }
                                : { background: "rgba(34,197,94,0.14)", color: "#4ade80" }
                            }
                          >
                            {Math.round(resolved.confidence)}%
                          </span>
                          <span className="text-[8.5px] tracking-[0.02em] text-empir-muted-2">
                            fiabilité localisation
                          </span>
                        </>
                      ) : null}
                      {canEditAddress && (
                        <button
                          type="button"
                          onClick={() => setEditingAddress(true)}
                          className="flex items-center gap-[3px] text-[8.5px] tracking-[0.02em] text-empir-muted transition-colors hover:text-empir-text"
                        >
                          <PencilLine className="size-[9px]" strokeWidth={1.8} />
                          {manualAddress ? "Modifier l'adresse" : "Je connais l'adresse"}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {!isManual && (
              <div className="flex shrink-0 flex-col items-center gap-1">
                <ScoreGauge score={quick.score} size={48} />
                <span className="text-[6px] font-bold tracking-[0.1em] text-empir-accent">
                  SCORE PRIX
                </span>
              </div>
            )}
          </div>

          {/* Rapprochements d'adresse trouvés par l'algo (liste déroulante) */}
          {!editingAddress && candidateRows.length > 0 && (
            // pt-4 = padding bas de la carte (16px) : le titre est centré
            // entre le séparateur et le bord de la carte.
            <div
              className="mt-[13px] border-t pt-4"
              style={{ borderTopColor: "rgba(255,255,255,0.06)" }}
            >
              <button
                type="button"
                onClick={() => setShowCandidates((v) => !v)}
                className="flex w-full items-center justify-between text-[8.5px] font-semibold uppercase tracking-[0.08em] text-empir-muted-2 transition-colors hover:text-empir-muted"
              >
                <span>
                  Rapprochements d'adresse ({candidateRows.length})
                </span>
                <ChevronDown
                  className={cn("size-3 transition-transform", showCandidates && "rotate-180")}
                  strokeWidth={1.8}
                />
              </button>
              {showCandidates && (
                <div className="mt-[6px]">
                  {candidateRows.map((c, i) => (
                    <div
                      key={`${c.address}-${i}`}
                      className="flex items-center gap-[7px] rounded-[6px] px-[4px] py-[5px] transition-colors hover:bg-white/[0.04]"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-[10px] leading-[1.35] text-empir-muted"
                        title={c.address}
                      >
                        {c.address}
                      </span>
                      <span
                        className="shrink-0 text-[9.5px] font-bold tabular-nums"
                        style={{ color: c.confidence < 60 ? "#f87171" : "#4ade80" }}
                        title="Fiabilité"
                      >
                        {Math.round(c.confidence)}%
                      </span>
                      {onCandidateValidate && (
                        <button
                          type="button"
                          onClick={() => onCandidateValidate(c)}
                          title="Valider cette adresse"
                          className="grid size-[20px] shrink-0 place-items-center rounded-[5px] transition-all hover:bg-white/10"
                          style={{ background: "rgba(255,255,255,0.05)" }}
                        >
                          <Check className="size-[11px] text-empir-muted" strokeWidth={2} />
                        </button>
                      )}
                      <a
                        href={mapsUrl(c.address)}
                        target="_blank"
                        rel="noreferrer"
                        title="Voir sur Google Maps"
                        className="grid size-[20px] shrink-0 place-items-center rounded-[5px] transition-all hover:bg-white/10"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      >
                        <ExternalLink className="size-[10px] text-empir-muted" strokeWidth={1.8} />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ─── CARACTÉRISTIQUES ─── */}
        <SectionHeader label="Caractéristiques du bien" />

        {quick.market && (
          <ComparablePriceCard
            medianPpm2={quick.market.medianPricePerM2}
            gapPct={quick.marketGapPct}
            comparables={quick.market.comparables}
            meta={
              comparablesMeta ??
              `${quick.market.sampleSize} ventes · rayon ${Math.round(quick.market.radiusM)} m${
                quick.market.windowMonths ? ` · ${quick.market.windowMonths} derniers mois` : ""
              }${
                quick.market.p25PricePerM2 && quick.market.p75PricePerM2
                  ? ` · P25-P75 : ${quick.market.p25PricePerM2}–${quick.market.p75PricePerM2} €`
                  : ""
              }`
            }
          />
        )}

        <div
          className={`${quick.market ? "mt-[11px]" : ""} rounded-empir-card border border-empir-line px-[14px]`}
          style={{ background: "rgba(28,34,50,0.5)" }}
        >
          {/* En-têtes de colonnes : Affiché (annonce) vs Réel (DPE ADEME) —
              sans annonce (mode manuel), il n'y a rien d'« affiché » à comparer. */}
          {hasAnnounced && (
            <div className="grid grid-cols-[1fr_4rem_4rem] gap-x-2 border-b border-empir-line py-[7px] text-[8.5px] font-bold uppercase tracking-[0.08em] text-empir-muted-2">
              <span />
              <span className="text-right">Affiché</span>
              <span className="text-right">Réel</span>
            </div>
          )}
          {listing.surface == null && realSurface != null && (
            <DataRow
              label="Surface habitable"
              value={`${realSurface.toLocaleString("fr-FR")} m²`}
              hint="d'après le DPE officiel"
            />
          )}
          {listing.surface != null && (
            <CharRow
              label="Surface habitable"
              shown={`${listing.surface} m²`}
              real={realSurface != null ? `${realSurface.toLocaleString("fr-FR")} m²` : undefined}
              mismatch={realSurface != null && Math.abs(realSurface - listing.surface) / listing.surface > 0.05}
            />
          )}
          {listing.landSurface != null && (
            <CharRow label="Surface parcelle" shown={`${listing.landSurface} m²`} />
          )}
          {listing.rooms != null && <CharRow label="Pièces" shown={`${listing.rooms}`} />}
          {listing.bedrooms != null && <CharRow label="Chambres" shown={`${listing.bedrooms}`} />}
          {parcelDisplay && (
            <DataRow
              label="N° de parcelle"
              value={
                parcelDisplay.section && parcelDisplay.numero
                  ? `${parcelDisplay.section} ${parcelDisplay.numero}`
                  : parcelDisplay.id
              }
              hint={parcelDisplay.id}
            />
          )}
          {copro && (
            <DataRow
              label="Copropriété"
              value={`${copro.lotsTotal} lots`}
              hint={
                copro.lotsHabitation != null
                  ? `${copro.lotsHabitation} à usage d'habitation`
                  : undefined
              }
            />
          )}
        </div>

        {/* ─── HISTORIQUE DE VENTE ─── */}
        <SectionHeader label="Historique de vente" />
        {salesHistory.length >= 2 ? (
          <div className="px-[2px] pt-1 pb-[2px]">
            <SalesTimeline nodes={salesHistory} />
            {salesSummary && (
              <div className="mt-2.5 text-center text-[10.5px] font-medium text-empir-muted">
                {salesSummary}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-empir-card border border-empir-line bg-empir-card px-[14px] py-3 text-[11px] text-empir-muted-2">
            Pas d'historique disponible
          </div>
        )}

        {/* ─── URBANISME ─── */}
        {urbanisme.length > 0 && (
          <>
            <SectionHeader label="Urbanisme" />
            <div className="space-y-2">
              {urbanisme.map((u, i) => (
                <UrbanismeCard key={`${u.zone}-${i}`} {...u} />
              ))}
            </div>
          </>
        )}

        {/* ─── RISQUES ─── */}
        {risks.length > 0 && (
          <>
            <SectionHeader label="Risques" />
            <RiskSummary risks={risks} />
          </>
        )}

        {/* ─── DPE RÉEL ─── */}
        {resolvedOk?.verifiedDpe && (
          <>
            <SectionHeader label="DPE réel" />
            <div
              className="rounded-empir-card border border-empir-line p-[14px]"
              style={{ background: "rgba(28,34,50,0.5)" }}
            >
              <DpeBars
                announced={listing.dpe?.toUpperCase() as DpeClass | undefined}
                verified={resolvedOk.verifiedDpe.class as DpeClass}
                note={`${resolvedOk.verifiedDpe.kwhM2} kWh/m²/an · ${resolvedOk.verifiedDpe.gesKgCO2M2} kg CO₂/m²/an`}
              />
              {dpeDetails && <DpeDetailsCard details={dpeDetails} />}
            </div>
          </>
        )}

        <div className="mt-4 text-center text-[8px] font-semibold uppercase tracking-[0.2em] text-empir-disabled">
          EMPIR · Bâtisseur d'Empire
        </div>
      </div>
    </div>
  );
}

/**
 * Ligne du tableau Caractéristiques : label + valeur affichée (annonce) +
 * valeur réelle (DPE). « Réel » en vert si présent, orange si écart notable,
 * gris « — » quand le DPE ne fournit pas la donnée (pièces, terrain…).
 */
function CharRow({
  label,
  shown,
  real,
  mismatch,
}: {
  label: string;
  shown: string;
  real?: string;
  mismatch?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-x-2 border-b border-empir-line py-[10px] text-[12.5px] last:border-b-0">
      <span className="text-empir-muted-2">{label}</span>
      <span className="text-right tabular-nums text-empir-text">{shown}</span>
      <span
        className={cn(
          "text-right tabular-nums",
          mismatch ? "text-empir-warn" : real ? "text-empir-success" : "text-empir-muted-2",
        )}
      >
        {real ?? "—"}
      </span>
    </div>
  );
}
