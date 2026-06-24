import { useState } from "react";
import { X } from "lucide-react";
import { EmpirButton } from "@/components/empir";

export interface UpgradeModalProps {
  /** Compteur utilisateur (15/15). */
  usage: { used: number; limit: number };
  onClose: () => void;
  onSubmit: (contact: { email?: string; phone?: string }) => Promise<void> | void;
}

export function UpgradeModal({ usage, onClose, onSubmit }: UpgradeModalProps) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email && !phone) {
      setErr("Renseignez un email ou un téléphone.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ email: email || undefined, phone: phone || undefined });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-[320px] rounded-empir-card-lg border border-empir-line bg-empir-panel p-5 shadow-empir-card">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-empir-icon text-empir-muted hover:bg-white/5 hover:text-empir-text"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </button>
        <div className="text-[10px] uppercase tracking-[0.2em] text-empir-muted-2">
          Quota atteint · {usage.used}/{usage.limit}
        </div>
        <h2 className="mt-2 text-[16px] font-semibold leading-tight text-empir-text">
          Débloquez les analyses illimitées
        </h2>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-empir-muted">
          Laissez un contact vérifié — l'équipe EMPIR vous offre l'accès illimité et vous
          tient au courant du SaaS complet.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
          <input
            type="email"
            placeholder="vous@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
          />
          <input
            type="tel"
            placeholder="+33 6 ··· ··· ···"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-10 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
          />
          <EmpirButton type="submit" disabled={busy} size="lg" className="mt-1">
            {busy ? "Validation…" : "Débloquer l'illimité"}
          </EmpirButton>
        </form>
        {err && <p className="mt-2 text-[11px] text-empir-danger">{err}</p>}
        <p className="mt-3 text-center text-[9.5px] text-empir-muted-2">
          Nous n'enverrons jamais de spam — un retour quand le SaaS EMPIR sortira.
        </p>
      </div>
    </div>
  );
}
