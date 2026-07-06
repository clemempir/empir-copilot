import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Client service-role (contourne RLS). À utiliser pour : log usage, lecture du
 * cache d'adresse, lookup du plan utilisateur. Ne JAMAIS exposer cette clé au
 * client de l'extension.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Récupère l'user authentifié depuis l'Authorization header (JWT). Renvoie
 * null si la requête est anonyme. `emailConfirmed` reflète la vérification
 * Supabase (les comptes Google sont confirmés d'office).
 */
export async function getAuthedUser(
  req: Request,
): Promise<{ id: string; email?: string; emailConfirmed: boolean } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const jwt = auth.slice("Bearer ".length);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user as { id: string; email?: string; email_confirmed_at?: string; confirmed_at?: string };
  return {
    id: u.id,
    email: u.email ?? undefined,
    emailConfirmed: Boolean(u.email_confirmed_at ?? u.confirmed_at),
  };
}

/** Hash SHA-256 hex truncated à 32 chars — suffisant pour fingerprint device/IP. */
export async function sha256Short(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 32);
}

export function getClientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    null
  );
}
