import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { browser } from "wxt/browser";
import { getSupabase } from "@/lib/supabase";

export interface UseAuth {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Inscription. `needsConfirmation` = un code a été envoyé par e-mail. */
  signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  /** Vérifie le code à 6 chiffres reçu après inscription → ouvre la session. */
  verifySignupCode(email: string, code: string): Promise<void>;
  /** Renvoie l'e-mail de confirmation (compte créé mais jamais vérifié). */
  resendSignupCode(email: string): Promise<void>;
  /** Envoie l'e-mail « mot de passe oublié » (code de récupération). */
  requestPasswordReset(email: string): Promise<void>;
  /** Vérifie le code de récupération puis pose le nouveau mot de passe. */
  resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<void>;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Traduit les erreurs Supabase Auth courantes en messages utilisateur. */
export function frenchAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(msg)) return "E-mail non confirmé.";
  if (/already registered/i.test(msg))
    return "Un compte existe déjà avec cet e-mail — connectez-vous.";
  if (/rate limit|too many/i.test(msg))
    return "Trop de tentatives — réessayez dans quelques minutes.";
  if (/token has expired|invalid otp|otp_expired/i.test(msg))
    return "Code invalide ou expiré — demandez un nouveau code.";
  if (/password should be at least/i.test(msg))
    return "Le mot de passe doit faire au moins 8 caractères.";
  return msg || "Erreur inconnue";
}

export function useAuth(): UseAuth {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supa = getSupabase();
    let mounted = true;
    void supa.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supa.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const supa = getSupabase();
  return {
    user: session?.user ?? null,
    session,
    loading,
    async signUpWithEmail(email, password) {
      const { data, error } = await supa.auth.signUp({ email, password });
      if (error) throw error;
      // Confirmation activée → pas de session tant que l'e-mail n'est pas
      // vérifié (l'utilisateur saisit le code reçu, cf. verifySignupCode).
      return { needsConfirmation: data.session == null };
    },
    async signInWithEmail(email, password) {
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signInWithGoogle() {
      // Flux extension (MV3) : le flux OAuth web classique ne fonctionne pas
      // dans un sidepanel. On ouvre la fenêtre Google via chrome.identity,
      // on récupère un id_token, et Supabase l'échange contre une session.
      // Le nonce lie les deux étapes (anti-rejeu) : Google reçoit son hash,
      // Supabase vérifie l'original.
      const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
      if (!clientId) {
        throw new Error("Connexion Google non configurée (VITE_GOOGLE_OAUTH_CLIENT_ID).");
      }
      const rawNonce = crypto.randomUUID();
      const hashedNonce = await sha256Hex(rawNonce);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "id_token");
      url.searchParams.set("redirect_uri", browser.identity.getRedirectURL());
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("nonce", hashedNonce);
      url.searchParams.set("prompt", "select_account");

      const responseUrl = await browser.identity.launchWebAuthFlow({
        url: url.toString(),
        interactive: true,
      });
      if (!responseUrl) throw new Error("Connexion Google annulée.");
      const fragment = new URLSearchParams(new URL(responseUrl).hash.slice(1));
      const idToken = fragment.get("id_token");
      if (!idToken) throw new Error("Connexion Google annulée.");

      const { error } = await supa.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
        nonce: rawNonce,
      });
      if (error) throw error;
    },
    async verifySignupCode(email, code) {
      const { error } = await supa.auth.verifyOtp({ type: "signup", email, token: code.trim() });
      if (error) throw error;
    },
    async resendSignupCode(email) {
      const { error } = await supa.auth.resend({ type: "signup", email });
      if (error) throw error;
    },
    async requestPasswordReset(email) {
      const { error } = await supa.auth.resetPasswordForEmail(email);
      if (error) throw error;
    },
    async resetPasswordWithCode(email, code, newPassword) {
      // Le code « recovery » ouvre une session temporaire, qui permet de
      // poser le nouveau mot de passe — tout se passe dans l'extension,
      // aucune page web nécessaire.
      const { error } = await supa.auth.verifyOtp({ type: "recovery", email, token: code.trim() });
      if (error) throw error;
      const { error: e2 } = await supa.auth.updateUser({ password: newPassword });
      if (e2) throw e2;
    },
    async signOut() {
      await supa.auth.signOut();
    },
  };
}
