import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { DpeDetails, DpePoste, DpeQuality } from "@empir/core";
import { cn } from "@/lib/utils";

/** Libellé français d'un poste de déperdition. */
const POSTE_LABEL: Record<DpePoste, string> = {
  murs: "murs",
  toiture: "toiture / combles",
  plancherBas: "plancher bas",
  fenetres: "fenêtres",
};

export interface DpeDetailsCardProps {
  details: DpeDetails;
  className?: string;
}

/** Qualité ADEME → couleur (danger/warn/success) + libellé de pastille. */
const QUALITY_STYLE: Record<DpeQuality, { pill: string; dot: string }> = {
  insuffisante: { pill: "bg-empir-danger/15 text-empir-danger", dot: "bg-empir-danger" },
  moyenne: { pill: "bg-empir-warn/15 text-empir-warn", dot: "bg-empir-warn" },
  bonne: { pill: "bg-empir-success/15 text-empir-success", dot: "bg-empir-success" },
  "très bonne": { pill: "bg-empir-success/15 text-empir-success", dot: "bg-empir-success" },
};

function QualityRow({ label, value }: { label: string; value: DpeQuality }) {
  const s = QUALITY_STYLE[value];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-empir-line py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className={cn("size-2 rounded-full", s.dot)} />
        <span className="text-[12px] text-empir-text">{label}</span>
      </div>
      <span
        className={cn(
          "rounded-empir-pill px-2 py-[3px] text-[10.5px] font-medium uppercase tracking-[0.08em]",
          s.pill,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Type de vitrage déduit de la qualité des menuiseries. L'ADEME n'expose pas le
 * vitrage en clair, mais la note (calculée sur le Uw) le trahit : le simple
 * vitrage donne toujours « insuffisante », le double « moyenne » et plus.
 * Étiqueté « estimé » — c'est une déduction, pas une donnée brute.
 */
const GLAZING: Record<DpeQuality, string> = {
  insuffisante: "Simple vitrage",
  moyenne: "Double vitrage",
  bonne: "Double vitrage",
  "très bonne": "Double / triple vitrage",
};

function WindowsRow({ value }: { value: DpeQuality }) {
  const s = QUALITY_STYLE[value];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-empir-line py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className={cn("size-2 rounded-full", s.dot)} />
        <span className="text-[12px] text-empir-text">Fenêtres</span>
      </div>
      <span className="text-right text-[11.5px] font-medium text-empir-text">
        {GLAZING[value]}
        <span className="block text-[10px] text-empir-muted-2">estimé · menuiseries {value}</span>
      </span>
    </div>
  );
}

/** Sous-ligne d'isolation (poste), indentée sous le titre « Isolation ». */
function IsoSubRow({ label, value, weak }: { label: string; value: DpeQuality; weak?: boolean }) {
  const s = QUALITY_STYLE[value];
  return (
    <div className="flex items-center justify-between gap-3 py-1 pl-[18px]">
      <div className="flex items-center gap-2.5">
        <span className={cn("size-1.5 rounded-full", s.dot)} />
        <span className={cn("text-[11.5px]", weak ? "font-medium text-empir-text" : "text-empir-muted")}>
          {label}
        </span>
      </div>
      <span
        className={cn(
          "rounded-empir-pill px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.08em]",
          s.pill,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Bloc « Isolation » : détail par poste ; retombe sur la note globale à défaut. */
function IsolationBlock({ details }: { details: DpeDetails }) {
  const { isolation, isolationMurs, isolationToiture, isolationPlancherBas, pointFaible } = details;
  const all: { poste: DpePoste; label: string; value?: DpeQuality }[] = [
    { poste: "murs", label: "Murs", value: isolationMurs },
    { poste: "toiture", label: "Toiture / combles", value: isolationToiture },
    { poste: "plancherBas", label: "Plancher bas", value: isolationPlancherBas },
  ];
  const postes = all.filter((p) => p.value);

  if (postes.length === 0) {
    return isolation ? <QualityRow label="Isolation" value={isolation} /> : null;
  }
  return (
    <div className="border-b border-empir-line py-2 last:border-b-0">
      <span className="text-[12px] text-empir-text">Isolation</span>
      <div className="mt-0.5">
        {postes.map((p) => (
          <IsoSubRow key={p.poste} label={p.label} value={p.value!} weak={p.poste === pointFaible} />
        ))}
      </div>
    </div>
  );
}

/**
 * Détail « second œuvre » du DPE réel (chauffage, fenêtres, isolation par poste),
 * dépliable. Conçu pour s'intégrer DANS l'encart DPE (sous les barres) : simple
 * séparateur, pas de carte autour. Met en avant le point faible dès l'état replié.
 */
export function DpeDetailsCard({ details, className }: DpeDetailsCardProps) {
  const [open, setOpen] = React.useState(false);
  const { chauffage, energieChauffage, isolation, isolationMurs, isolationToiture, isolationPlancherBas, fenetres, pointFaible } = details;
  const hasIso = Boolean(isolation || isolationMurs || isolationToiture || isolationPlancherBas);
  if (!chauffage && !hasIso && !fenetres) return null;

  return (
    <div className={cn("mt-3 border-t border-empir-line pt-1", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left"
      >
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[12px] font-semibold text-empir-text">Détail DPE</span>
          {pointFaible ? (
            <span className="truncate text-[10.5px] text-empir-danger">· point faible : {POSTE_LABEL[pointFaible]}</span>
          ) : hasIso ? (
            <span className="truncate text-[10.5px] text-empir-success">· bien isolé</span>
          ) : (
            <span className="truncate text-[10.5px] text-empir-muted-2">· chauffage, fenêtres</span>
          )}
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-empir-muted transition-transform", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </button>

      {open && (
        <div className="pb-0.5">
          {chauffage && (
            <div className="flex items-center justify-between gap-3 border-b border-empir-line py-2 last:border-b-0">
              <span className="text-[12px] text-empir-text">Chauffage</span>
              <span className="max-w-[62%] text-right text-[11.5px] font-medium text-empir-text">
                {chauffage}
                {energieChauffage && !chauffage.toLowerCase().includes(energieChauffage.toLowerCase()) && (
                  <span className="block text-[10px] text-empir-muted-2">{energieChauffage}</span>
                )}
              </span>
            </div>
          )}
          {fenetres && <WindowsRow value={fenetres} />}
          <IsolationBlock details={details} />
        </div>
      )}
    </div>
  );
}
