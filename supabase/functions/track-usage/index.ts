/**
 * track-usage — modèle freemium « 3 essais puis compte vérifié » :
 *
 *   - ANONYME : 3 analyses gratuites À VIE par appareil (deviceHash).
 *   - COMPTE VÉRIFIÉ (e-mail confirmé ou Google) : illimité — l'extension est
 *     gratuite, la monétisation passe par l'application SaaS séparée.
 *   - Compte NON vérifié : traité comme anonyme (ne débloque rien).
 *
 * POST { deviceHash, listingUrl }
 * Réponse : { used, limit, allowed, plan, reason? }
 *   plan ∈ { "free", "verified" } ; limit=null quand illimité ;
 *   reason="account_required" quand les 3 essais sont épuisés.
 *
 * Note : ce endpoint enregistre l'usage UNIQUEMENT si `allowed=true`. Il est
 * appelé en amont de `resolve-address`/`analyze`.
 */
import { handleCorsPreflight, corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, getAuthedUser, getClientIp, sha256Short } from "../_shared/supabase.ts";

/** Essais gratuits sans compte — à vie par appareil, pas de fenêtre glissante. */
const FREE_TRIALS = 3;

interface TrackUsageBody {
  deviceHash: string;
  listingUrl: string;
  resolvedAddress?: string;
  confidence?: number;
  /** Si false (défaut true), ne log pas (preview du quota seulement). */
  commit?: boolean;
}

Deno.serve(async (req: Request) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: TrackUsageBody;
  try {
    body = (await req.json()) as TrackUsageBody;
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  if (!body.deviceHash || !body.listingUrl) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }

  const supa = serviceClient();
  const user = await getAuthedUser(req);
  const ip = getClientIp(req);
  const ipSalt = Deno.env.get("IP_HASH_SALT") ?? "empir-salt";
  const ipHash = ip ? await sha256Short(`${ip}:${ipSalt}`) : null;

  // Compte vérifié (e-mail confirmé / Google) → illimité. On log quand même
  // l'usage pour les statistiques produit, sans bloquer la réponse : ce log
  // ne gate aucun quota, il peut finir après l'envoi.
  if (user?.emailConfirmed) {
    if (body.commit !== false) {
      const pending = logUsage(supa, user.id, body, ipHash).catch(() => {});
      (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
        .EdgeRuntime?.waitUntil?.(pending);
    }
    return jsonResponse({ used: 0, limit: null, allowed: true, plan: "verified" });
  }

  // Anonyme (ou compte non vérifié) : 3 essais à vie par appareil.
  const { count } = await supa
    .from("usage_log")
    .select("id", { count: "exact", head: true })
    .eq("device_hash", body.deviceHash);
  const used = count ?? 0;
  const allowed = used < FREE_TRIALS;

  if (allowed && body.commit !== false) {
    await logUsage(supa, user?.id ?? null, body, ipHash);
  }

  return jsonResponse({
    used: used + (allowed && body.commit !== false ? 1 : 0),
    limit: FREE_TRIALS,
    allowed,
    plan: "free",
    ...(allowed ? {} : { reason: "account_required" }),
  });
});

async function logUsage(
  supa: ReturnType<typeof serviceClient>,
  userId: string | null,
  body: TrackUsageBody,
  ipHash: string | null,
): Promise<void> {
  await supa.from("usage_log").insert({
    user_id: userId,
    device_hash: body.deviceHash,
    ip_hash: ipHash,
    listing_url: body.listingUrl,
    resolved_address: body.resolvedAddress ?? null,
    confidence: body.confidence ?? null,
  });
}
