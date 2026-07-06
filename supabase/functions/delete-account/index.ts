/**
 * delete-account — suppression de compte (RGPD).
 *
 * POST (aucun body) avec Bearer JWT obligatoire : supprime l'utilisateur
 * authentifié via l'API admin. Les données liées suivent les règles de la
 * base : users_profile / saved_listings / notifications supprimés en cascade,
 * usage_log anonymisé (user_id → null, le deviceHash reste pour le quota —
 * sinon supprimer son compte ré-offrirait les 3 essais gratuits).
 */
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { serviceClient, getAuthedUser } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const supa = serviceClient();
  const { error } = await supa.auth.admin.deleteUser(user.id);
  if (error) return json({ error: error.message }, 500);

  return json({ deleted: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
