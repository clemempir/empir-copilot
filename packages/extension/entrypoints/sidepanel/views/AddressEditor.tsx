import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, X } from "lucide-react";
import { geocodeSuggest, type GeoPoint } from "@empir/core";

/**
 * Saisie manuelle de l'adresse (option « Je connais l'adresse ») : champ
 * inline avec autocomplétion BAN (Géoplateforme). Chaque suggestion est une
 * adresse officielle géocodée — impossible de soumettre une adresse invalide.
 * Le biais lat/lon (marqueur de l'annonce) fait remonter la bonne commune en
 * tête sans jamais filtrer : une adresse d'une autre ville reste trouvable.
 */

export interface AddressEditorProps {
  /** Biais de proximité pour l'autocomplétion (marqueur de l'annonce). */
  nearby?: { lat: number; lon: number };
  onSubmit: (point: GeoPoint) => void;
  onCancel: () => void;
}

export function AddressEditor({ nearby, onSubmit, onCancel }: AddressEditorProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<GeoPoint[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Autocomplétion débouncée (250 ms), annulée si la frappe continue.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      geocodeSuggest(q, { nearby, signal: ctrl.signal })
        // Une commune seule ne suffit pas : sans rue ni numéro, ni le cadastre
        // ni le DPE ne peuvent être ciblés (et le label n'a pas de code postal).
        .then((pts) => setSuggestions(pts.filter((p) => p.precision !== "municipality")))
        .catch(() => {
          /* frappe suivante ou réseau — silencieux */
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, nearby]);

  const pick = (s: GeoPoint) => onSubmit(s);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-[5px]">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && suggestions[0]) pick(suggestions[0]);
          }}
          placeholder="N°, rue, ville…"
          className="min-w-0 flex-1 rounded-[6px] border border-empir-line bg-transparent px-[8px] py-[4px] text-[10px] text-empir-text outline-none placeholder:text-empir-muted-2 focus:border-empir-accent/60"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />
        <button
          type="button"
          onClick={onCancel}
          title="Annuler"
          className="grid size-[22px] shrink-0 place-items-center rounded-[6px] transition-all hover:bg-white/10"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <X className="size-3 text-empir-muted" strokeWidth={1.8} />
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-[4px] overflow-hidden rounded-[6px] border border-empir-line" style={{ background: "rgba(28,34,50,0.92)" }}>
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat},${s.lon}`}
              type="button"
              onClick={() => pick(s)}
              className="flex w-full items-center gap-[6px] px-[8px] py-[5px] text-left text-[10px] leading-[1.3] text-empir-muted transition-all hover:bg-white/10 hover:text-empir-text"
            >
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {i === 0 && (
                <CornerDownLeft className="size-[10px] shrink-0 text-empir-muted-2" strokeWidth={1.8} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
