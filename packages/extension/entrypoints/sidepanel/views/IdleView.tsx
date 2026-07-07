import { Search, Sparkles, User } from "lucide-react";
import type { Listing } from "@empir/core";
import { EmpirButton } from "@/components/empir";

export interface IdleViewProps {
  /** Annonce détectée sur l'onglet courant (null → invite à en ouvrir une). */
  listing?: Listing | null;
  /** Lance l'analyse de l'annonce détectée (CTA principal). */
  onAnalyze?: () => void;
  /** Accès au compte — disponible même sans annonce détectée. */
  onAccountClick: () => void;
  /** Notification non lue → pastille rouge sur le bouton compte. */
  hasUnread?: boolean;
}

/**
 * Écran d'accueil du sidepanel. L'analyse ne se lance JAMAIS toute seule :
 * l'utilisateur peut ouvrir l'extension pour consulter son compte sans
 * consommer une analyse — le CTA « Lancer l'analyse » n'apparaît que si une
 * annonce est détectée sur la page.
 */
export function IdleView({ listing, onAnalyze, onAccountClick, hasUnread }: IdleViewProps) {
  return (
    <div className="flex h-full flex-col">
      {/* En-tête permanent : le compte est accessible même hors annonce. */}
      <header
        className="flex items-end justify-between border-b px-[18px] pb-[13px] pt-[22px]"
        style={{ background: "#0d121d", borderBottomColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-[0.16em] text-empir-text">
            EMPIR Copilot
          </span>
          <span className="mt-1 max-w-[220px] text-[8px] font-semibold uppercase leading-[1.3] tracking-[0.08em] text-empir-muted-2">
            Reprenez le contrôle de l'information
          </span>
        </div>
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
              style={{ background: "#ff5d73", border: "1.5px solid #0d121d" }}
            />
          )}
        </button>
      </header>

      {/* pb-16 ≈ hauteur de l'en-tête : recentre optiquement sur la page entière. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        {listing && onAnalyze ? (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-empir-primary/15">
              <Sparkles className="size-7 text-empir-accent" />
            </div>
            <h2 className="mt-5 text-[15px] font-semibold text-empir-text">Annonce détectée</h2>
            <p className="mt-2 max-w-[260px] truncate text-[12px] leading-relaxed text-empir-muted">
              {listing.title ?? listing.url}
            </p>
            <p className="mt-1 text-[12px] font-semibold tabular-nums text-empir-text">
              {[
                listing.propertyType,
                listing.surface != null ? `${listing.surface} m²` : null,
                `${listing.price.toLocaleString("fr-FR")} €`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <EmpirButton type="button" size="lg" className="mt-6 w-full max-w-[280px]" onClick={onAnalyze}>
              Lancer l'analyse
            </EmpirButton>
            <p className="mt-3 max-w-[260px] text-[10.5px] leading-relaxed text-empir-muted-2">
              Adresse réelle, DPE officiel, prix du quartier et risques — en quelques secondes.
            </p>
          </>
        ) : (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-empir-primary/15">
              <Search className="size-7 text-empir-accent" />
            </div>
            <h2 className="mt-5 text-[15px] font-semibold text-empir-text">
              Ouvrez une annonce immobilière
            </h2>
            <p className="mt-2 max-w-[260px] text-[12px] leading-relaxed text-empir-muted">
              Leboncoin, SeLoger, Bien'ici, Citya — EMPIR détecte l'annonce et vous
              donne l'adresse réelle + les données officielles en quelques secondes.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
