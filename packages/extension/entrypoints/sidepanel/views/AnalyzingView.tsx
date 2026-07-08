import { useEffect, useState } from "react";
import type { Listing } from "@empir/core";
import {
  EmpirLogo,
  PROPERTY_VISUALS,
  propertyKind,
  StepProgress,
  type StepStatus,
} from "@/components/empir";

const STEPS = [
  "Lecture de l'annonce",
  "Croisement base ADEME (DPE)",
  "Recherche cadastrale (IGN)",
  "Comparables DVF du voisinage",
  "Géorisques + PLU + taxe foncière",
];

export interface AnalyzingViewProps {
  /** Bien en cours d'analyse — affiche le visuel maison/appartement/immeuble. */
  listing?: Listing | null;
}

export function AnalyzingView({ listing }: AnalyzingViewProps) {
  // Progression simulée : reflète le pipeline parallèle côté Edge Function.
  // Le sidepanel passera en mode `result` dès la réception de la réponse.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => Math.min(t + 1, STEPS.length * 4)), 250);
    return () => clearInterval(id);
  }, []);

  const activeIdx = Math.min(Math.floor(tick / 4), STEPS.length - 1);
  const percent = Math.min((tick / (STEPS.length * 4)) * 100, 92);

  const steps: { label: string; status: StepStatus }[] = STEPS.map((label, i) => ({
    label,
    status: i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
  }));

  return (
    <div className="flex h-full flex-col px-5 py-7">
      <EmpirLogo size="sm" />
      {/* Contenu centré verticalement (pb compense le logo), comme l'accueil. */}
      <div className="flex flex-1 flex-col items-center justify-center pb-12">
        <div className="relative size-28">
          <span className="absolute inset-0 rounded-full bg-empir-primary/15 animate-[ping_2.6s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <span className="absolute inset-2 rounded-full bg-empir-primary/20" />
          <span className="absolute inset-5 rounded-full bg-gradient-to-br from-empir-primary to-empir-primary-dark shadow-empir-glow" />
          {listing && (
            <img
              src={PROPERTY_VISUALS[propertyKind(listing)].src}
              alt={PROPERTY_VISUALS[propertyKind(listing)].alt}
              className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 object-contain"
              style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))" }}
            />
          )}
        </div>
        <h2 className="mt-7 text-[15.5px] font-semibold text-empir-text">
          Analyse du bien en cours
        </h2>
        <p className="mt-1.5 max-w-[260px] text-center text-[11.5px] text-empir-muted">
          EMPIR croise les sources officielles pour résoudre l'adresse et vérifier les données…
        </p>
        {/* Largeur bornée + centrée (même gabarit que le CTA de l'accueil). */}
        <div className="mt-8 w-full max-w-[280px]">
          <StepProgress steps={steps} percent={percent} />
        </div>
      </div>
    </div>
  );
}
