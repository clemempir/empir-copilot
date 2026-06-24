import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { EmpirButton, EmpirLogo } from "@/components/empir";

export interface SignupViewProps {
  onBack: () => void;
  onGoogleSignIn: () => Promise<void> | void;
  onEmailSignIn: (email: string, password: string) => Promise<void> | void;
  onSwitchToLogin: () => void;
  contextLabel?: string;
}

export function SignupView({
  onBack,
  onGoogleSignIn,
  onEmailSignIn,
  onSwitchToLogin,
  contextLabel = "Sauvegarde de l'annonce",
}: SignupViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy("email");
    setErr(null);
    try {
      await onEmailSignIn(email, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy("google");
    setErr(null);
    try {
      await onGoogleSignIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-empir-bg">
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-7 place-items-center rounded-empir-icon text-empir-muted hover:bg-white/5 hover:text-empir-text"
          aria-label="Retour à l'analyse"
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="text-[11px] uppercase tracking-[0.2em] text-empir-muted-2">
          {contextLabel}
        </span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
        <EmpirLogo size="lg" withTagline />
        <h1 className="mt-7 text-center text-[18px] font-semibold leading-tight text-empir-text">
          Créez un compte EMPIR
        </h1>
        <p className="mt-2 max-w-[280px] text-center text-[12px] text-empir-muted">
          Sauvegardez vos annonces, débloquez les analyses illimitées et recevez des alertes ciblées.
        </p>

        <EmpirButton
          type="button"
          variant="secondary"
          size="lg"
          className="mt-6 w-full max-w-[280px]"
          onClick={google}
          disabled={busy !== null}
        >
          <GoogleGlyph />
          {busy === "google" ? "Connexion…" : "Continuer avec Google"}
        </EmpirButton>

        <div className="my-5 flex w-full max-w-[280px] items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-empir-muted-2">
          <span className="h-px flex-1 bg-empir-line" />
          ou par email
          <span className="h-px flex-1 bg-empir-line" />
        </div>

        <form onSubmit={submit} className="flex w-full max-w-[280px] flex-col gap-2.5">
          <input
            type="email"
            placeholder="vous@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
            required
          />
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
            required
            minLength={8}
          />
          <EmpirButton type="submit" size="lg" className="mt-1" disabled={busy !== null}>
            {busy === "email" ? "Création…" : "Créer mon compte"}
          </EmpirButton>
        </form>

        {err && <p className="mt-3 text-[11px] text-empir-danger">{err}</p>}

        <p className="mt-5 text-center text-[11px] text-empir-muted-2">
          Déjà un compte ?{" "}
          <button type="button" onClick={onSwitchToLogin} className="text-empir-accent hover:underline">
            Se connecter
          </button>
        </p>
        <p className="mt-6 max-w-[280px] text-center text-[9.5px] leading-relaxed text-empir-muted-2">
          En créant un compte, vous acceptez les CGU EMPIR et notre politique de confidentialité.
          Aucune donnée n'est revendue.
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-[14px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 6.2 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 7.2 29.4 5 24 5 16.3 5 9.7 9.5 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.4l-6.3-5.3c-2.1 1.7-4.7 2.7-7.4 2.7-5.3 0-9.7-3.3-11.3-8L6 33C9.4 39.4 16.1 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C42.2 35 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
