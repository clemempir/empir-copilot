/**
 * Headers CORS partagés par toutes les Edge Functions EMPIR.
 * L'extension est chargée depuis chrome-extension:// ou moz-extension:// — on
 * autorise large car les requêtes sont déjà authentifiées par JWT/API key.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-empir-device-hash",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

/** Réponse JSON avec les en-têtes CORS — utilisée par toutes les fonctions. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
