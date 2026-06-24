import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export interface UseAuth {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUpWithEmail(email: string, password: string): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
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
      const { error } = await supa.auth.signUp({ email, password });
      if (error) throw error;
    },
    async signInWithEmail(email, password) {
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signInWithGoogle() {
      const { error } = await supa.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: typeof location !== "undefined" ? location.origin : undefined },
      });
      if (error) throw error;
    },
    async signOut() {
      await supa.auth.signOut();
    },
  };
}
