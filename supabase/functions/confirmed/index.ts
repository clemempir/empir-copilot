/**
 * confirmed — page d'atterrissage du lien de confirmation d'e-mail.
 *
 * Le lien de l'e-mail passe par /auth/v1/verify (Supabase valide le compte)
 * puis redirige ici. La page confirme visuellement et invite à retourner dans
 * l'extension — qui détecte la validation toute seule (polling côté sidepanel).
 * En cas de lien expiré/déjà utilisé, Supabase ajoute error_description à
 * l'URL : un petit script bascule alors le message vers « utilisez le code ».
 *
 * Déployée SANS vérification JWT (page publique) :
 *   supabase functions deploy confirmed --no-verify-jwt
 */
const PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EMPIR Copilot — compte confirmé</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center;
           background:#0b0f17; color:#e7ecf3;
           font-family:'Roboto Flex',Arial,sans-serif; }
    .card { max-width:420px; margin:16px; padding:40px 44px; text-align:center;
            background:#151b2a; border:1px solid rgba(255,255,255,0.10);
            border-radius:14px; }
    .logo { font-weight:700; font-size:15px; letter-spacing:0.16em; }
    .tag  { font-weight:600; font-size:8px; letter-spacing:0.08em; color:#6b7488;
            margin-top:4px; text-transform:uppercase; }
    .icon { font-size:40px; margin:26px 0 10px; }
    h1 { margin:0; font-size:21px; letter-spacing:-0.01em; }
    p  { margin:12px 0 0; font-size:13.5px; line-height:1.6; color:#8a93a6; }
    .hint { margin-top:22px; padding:13px 16px; font-size:11.5px; line-height:1.55;
            color:#8a93a6; background:rgba(124,108,255,0.08);
            border:1px solid rgba(124,108,255,0.18); border-radius:10px; }
    .err { display:none; }
    .has-error .ok  { display:none; }
    .has-error .err { display:block; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="logo">EMPIR&nbsp;Copilot</div>
    <div class="tag">Reprenez le contrôle de l'information</div>

    <div class="ok">
      <div class="icon">✅</div>
      <h1>Compte confirmé&nbsp;!</h1>
      <p>Votre adresse e-mail est vérifiée. Vous pouvez fermer cet onglet&nbsp;:
         l'extension va ouvrir votre session automatiquement.</p>
      <div class="hint">Analyses illimitées débloquées. Bonne chasse, bâtisseur.</div>
    </div>

    <div class="err">
      <div class="icon">⌛</div>
      <h1>Lien expiré ou déjà utilisé</h1>
      <p>Pas de panique&nbsp;: retournez dans l'extension et saisissez le
         <strong style="color:#e7ecf3;">code à 6&nbsp;chiffres</strong> de
         l'e-mail, ou demandez un nouvel envoi.</p>
    </div>
  </div>
  <script>
    // Supabase signale un échec via error/error_description (query ou fragment).
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.slice(1));
    if (q.get("error") || h.get("error") || q.get("error_description") || h.get("error_description")) {
      document.getElementById("card").classList.add("has-error");
    }
  </script>
</body>
</html>`;

Deno.serve(() => {
  return new Response(PAGE, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
