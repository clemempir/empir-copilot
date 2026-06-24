/**
 * track-usage — enforce le quota freemium 15 analyses / 30 jours.
 *
 * POST { deviceHash, listingUrl }
 * Auth optionnelle : si Bearer JWT présent, comptage par user_id ; sinon par
 *   (deviceHash, ip_hash). Le plan 'unlimited' bypass la limite.
 *
 * Réponse : { used, limit, allowed, plan }
 *
 * Note : ce endpoint enregistre l'usage UNIQUEMENT si `allowed=true`. Il est
 * appelé en amont de `resolve-address`/`analyze`.
 */
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { serviceClient, getAuthedUser, getClientIp, sha256Short } from "../_shared/supabase.ts";

const FREE_LIMIT = 15;
const WINDOW_MS = 30 * 24 * 3600 * 1000;

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
  const ipHash = ip ? await sha256Short(`${ip}:empir-salt`) : null;

  let plan: "free" | "unlimited" = "free";
  if (user) {
    const { data } = await supa
      .from("users_profile")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    plan = ((data?.plan as "free" | "unlimited" | undefined) ?? "free");
  }

  if (plan === "unlimited") {
    if (body.commit !== false) await logUsage(supa, user?.id ?? null, body, ipHash);
    return jsonResponse({ used: 0, limit: Infinity, allowed: true, plan });
  }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  let usedQuery = supa
    .from("usage_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (user) usedQuery = usedQuery.eq("user_id", user.id);
  else usedQuery = usedQuery.eq("device_hash", body.deviceHash);

  const { count } = await usedQuery;
  const used = count ?? 0;
  const allowed = used < FREE_LIMIT;

  if (allowed && body.commit !== false) {
    await logUsage(supa, user?.id ?? null, body, ipHash);
  }

  return jsonResponse({ used: used + (allowed && body.commit !== false ? 1 : 0), limit: FREE_LIMIT, allowed, plan });
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
