import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { DpeDetails, DpeQuality } from "@empir/core";
import { cn } from "@/lib/utils";

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
 * Détail « second œuvre » du DPE réel (chauffage, fenêtres, isolation), dépliable.
 * Met en avant les points critiques (qualité « insuffisante ») dès l'état replié.
 */
export function DpeDetailsCard({ details, className }: DpeDetailsCardProps) {
  const [open, setOpen] = React.useState(false);
  const { chauffage, energieChauffage, isolation, fenetres } = details;
  if (!chauffage && !isolation && !fenetres) return null;

  const critical = [isolation, fenetres].filter((q) => q === "insuffisante").length;

  return (
    <div className={cn("mt-[11px] overflow-hidden rounded-empir-card border border-empir-line bg-empir-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[12px] font-semibold text-empir-text">Détail du logement</span>
          {critical > 0 ? (
            <span className="truncate text-[10.5px] text-empir-danger">
              · {critical} point{critical > 1 ? "s" : ""} à surveiller
            </span>
          ) : (
            <span className="truncate text-[10.5px] text-empir-muted-2">· chauffage, isolation, fenêtres</span>
          )}
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-empir-muted transition-transform", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </button>

      {open && (
        <div className="border-t border-empir-line px-3.5 pb-1.5 pt-0.5">
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
          {fenetres && <QualityRow label="Fenêtres" value={fenetres} />}
          {isolation && <QualityRow label="Isolation" value={isolation} />}
        </div>
      )}
    </div>
  );
}
