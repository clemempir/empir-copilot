import { useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { EmpirButton } from "@/components/empir";
import { frenchAuthError } from "@/lib/hooks/use-auth";

/**
 * Écran d'authentification — 5 modes dans une seule vue :
 *   signup  : création de compte (défaut)
 *   login   : connexion d'un compte existant
 *   confirm : saisie du code à 6 chiffres reçu par e-mail (vérification)
 *   forgot  : demande de réinitialisation du mot de passe
 *   reset   : saisie du code de récupération + nouveau mot de passe
 * La vérification se fait ENTIÈREMENT dans l'extension (codes OTP), aucune
 * page web n'est nécessaire.
 */

type Mode = "signup" | "login" | "confirm" | "forgot" | "reset";

export interface SignupViewProps {
  onBack: () => void;
  onGoogleSignIn: () => Promise<void> | void;
  /** Inscription — renvoie true si un code de confirmation a été envoyé. */
  onSignup: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  onLogin: (email: string, password: string) => Promise<void>;
  onVerifySignup: (email: string, code: string) => Promise<void>;
  onResendCode: (email: string) => Promise<void>;
  onForgot: (email: string) => Promise<void>;
  onResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  /** Appelé quand une session est ouverte (compte créé+vérifié ou connexion). */
  onAuthenticated: () => void;
  contextLabel?: string;
}

const TITLES: Record<Mode, { title: string; sub: string; cta: string }> = {
  signup: {
    title: "Créez un compte EMPIR",
    sub: "Compte gratuit et vérifié : analyses illimitées, annonces sauvegardées, alertes.",
    cta: "Créer mon compte",
  },
  login: {
    title: "Content de vous revoir",
    sub: "Connectez-vous pour retrouver vos analyses illimitées et vos biens sauvegardés.",
    cta: "Se connecter",
  },
  confirm: {
    title: "Vérifiez votre e-mail",
    sub: "Saisissez le code à 6 chiffres que nous venons de vous envoyer.",
    cta: "Vérifier",
  },
  forgot: {
    title: "Mot de passe oublié",
    sub: "Indiquez votre e-mail : nous vous envoyons un code de réinitialisation.",
    cta: "Envoyer le code",
  },
  reset: {
    title: "Nouveau mot de passe",
    sub: "Saisissez le code reçu par e-mail et choisissez un nouveau mot de passe.",
    cta: "Changer le mot de passe",
  },
};

const INPUT_CLS =
  "h-10 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none";

export function SignupView({
  onBack,
  onGoogleSignIn,
  onSignup,
  onLogin,
  onVerifySignup,
  onResendCode,
  onForgot,
  onResetPassword,
  onAuthenticated,
  contextLabel = "Compte EMPIR",
}: SignupViewProps) {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr(null);
    setInfo(null);
    setCode("");
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setErr(frenchAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      if (mode === "signup") {
        const { needsConfirmation } = await onSignup(email, password);
        if (needsConfirmation) switchMode("confirm");
        else onAuthenticated();
      } else if (mode === "login") {
        try {
          await onLogin(email, password);
          onAuthenticated();
        } catch (e) {
          // Compte jamais vérifié → on enchaîne sur la saisie du code.
          if (/email not confirmed/i.test(e instanceof Error ? e.message : "")) {
            await onResendCode(email);
            switchMode("confirm");
            setInfo("Votre compte n'était pas vérifié — un nouveau code vient d'être envoyé.");
            return;
          }
          throw e;
        }
      } else if (mode === "confirm") {
        await onVerifySignup(email, code);
        onAuthenticated();
      } else if (mode === "forgot") {
        await onForgot(email);
        switchMode("reset");
        setInfo("Code envoyé — vérifiez votre boîte mail (et les spams).");
      } else if (mode === "reset") {
        await onResetPassword(email, code, password);
        onAuthenticated();
      }
    });
  };

  const google = () =>
    guard(async () => {
      await onGoogleSignIn();
      onAuthenticated();
    });

  const { title, sub } = TITLES[mode];

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
        {mode === "confirm" && (
          <MailCheck className="mb-5 size-10 text-empir-accent" strokeWidth={1.5} />
        )}
        <h1 className="text-center text-[18px] font-semibold leading-tight text-empir-text">
          {title}
        </h1>
        <p className="mt-2 max-w-[280px] text-center text-[12px] text-empir-muted">{sub}</p>

        {(mode === "signup" || mode === "login") && (
          <>
            <EmpirButton
              type="button"
              variant="secondary"
              size="lg"
              className="mt-6 w-full max-w-[280px]"
              onClick={() => void google()}
              disabled={busy}
            >
              <GoogleGlyph />
              Continuer avec Google
            </EmpirButton>
            <div className="my-5 flex w-full max-w-[280px] items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-empir-muted-2">
              <span className="h-px flex-1 bg-empir-line" />
              ou par email
              <span className="h-px flex-1 bg-empir-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="mt-4 flex w-full max-w-[280px] flex-col gap-2.5">
          {(mode === "signup" || mode === "login" || mode === "forgot") && (
            <input
              type="email"
              placeholder="vous@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLS}
              required
            />
          )}
          {(mode === "confirm" || mode === "reset") && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${INPUT_CLS} text-center tracking-[0.4em]`}
              required
              minLength={6}
              maxLength={6}
            />
          )}
          {(mode === "signup" || mode === "login" || mode === "reset") && (
            <input
              type="password"
              placeholder={mode === "reset" ? "Nouveau mot de passe" : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLS}
              required
              minLength={8}
            />
          )}
          <EmpirButton type="submit" size="lg" className="mt-1" disabled={busy}>
            {busy ? "Un instant…" : TITLES[mode].cta}
          </EmpirButton>
        </form>

        {err && <p className="mt-3 max-w-[280px] text-center text-[11px] text-empir-danger">{err}</p>}
        {info && (
          <p className="mt-3 max-w-[280px] text-center text-[11px] text-empir-accent">{info}</p>
        )}

        <div className="mt-5 flex flex-col items-center gap-1.5 text-center text-[11px] text-empir-muted-2">
          {mode === "signup" && (
            <span>
              Déjà un compte ?{" "}
              <LinkBtn onClick={() => switchMode("login")}>Se connecter</LinkBtn>
            </span>
          )}
          {mode === "login" && (
            <>
              <span>
                Pas encore de compte ?{" "}
                <LinkBtn onClick={() => switchMode("signup")}>Créer un compte</LinkBtn>
              </span>
              <LinkBtn onClick={() => switchMode("forgot")}>Mot de passe oublié ?</LinkBtn>
            </>
          )}
          {mode === "confirm" && (
            <LinkBtn
              onClick={() =>
                void guard(async () => {
                  await onResendCode(email);
                  setInfo("Nouveau code envoyé.");
                })
              }
            >
              Renvoyer le code
            </LinkBtn>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <LinkBtn onClick={() => switchMode("login")}>Retour à la connexion</LinkBtn>
          )}
        </div>

        {mode === "signup" && (
          <p className="mt-6 max-w-[280px] text-center text-[9.5px] leading-relaxed text-empir-muted-2">
            En créant un compte, vous acceptez les CGU EMPIR et notre politique de confidentialité.
            Aucune donnée n'est revendue.
          </p>
        )}
      </div>
    </div>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-empir-accent hover:underline">
      {children}
    </button>
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
