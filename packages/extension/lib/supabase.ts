import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { browser } from "wxt/browser";

/**
 * Adapter de stockage Supabase pour les extensions WebExtension :
 * persiste session/refresh-token dans `chrome.storage.local` (synchronisé entre
 * popup, sidepanel, options et background SW).
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const val = await browser.storage.local.get(key);
    return (val[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis dans packages/extension/.env.local",
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: chromeStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/**
 * Calcule un device hash stable basé sur un installId persisté en
 * chrome.storage.local + le userAgent. Régénère uniquement si l'installation
 * change (effacée par l'utilisateur, désinstallation).
 */
const DEVICE_INSTALL_ID_KEY = "empir:install-id";

export async function getDeviceHash(): Promise<string> {
  const stored = await browser.storage.local.get(DEVICE_INSTALL_ID_KEY);
  let installId = stored[DEVICE_INSTALL_ID_KEY] as string | undefined;
  if (!installId) {
    installId = crypto.randomUUID();
    await browser.storage.local.set({ [DEVICE_INSTALL_ID_KEY]: installId });
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "sw";
  const raw = `${installId}::${ua}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Helper pour appeler une Edge Function avec auth optionnel. */
export async function invokeEdge<T>(
  fnName: "track-usage" | "resolve-address" | "analyze",
  body: Record<string, unknown>,
): Promise<T> {
  const supa = getSupabase();
  const { data, error } = await supa.functions.invoke<T>(fnName, { body });
  if (error) throw error;
  return data as T;
}
