import { Search } from "lucide-react";

export function IdleView() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
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
    </div>
  );
}
