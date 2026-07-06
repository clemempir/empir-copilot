// send-broadcast — envoie une annonce EMPIR (promo, nouveauté…) à TOUS les
// clients : une notification par utilisateur, visible dans le sidepanel
// (cloche du compte, pastille rouge tant que non lue).
//
// Usage :
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... \
//     pnpm broadcast "Titre de l'annonce" "Texte du message"
//
// (mêmes variables d'environnement que le collecteur)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const [title, body] = process.argv.slice(2);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_KEY.");
  process.exit(1);
}
if (!title) {
  console.error('Usage : pnpm broadcast "Titre" "Message (optionnel)"');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

async function listAllUserIds() {
  const ids = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users_profile?select=id&offset=${offset}&limit=${pageSize}`,
      { headers },
    );
    if (!res.ok) throw new Error(`users_profile: HTTP ${res.status} ${await res.text()}`);
    const rows = await res.json();
    ids.push(...rows.map((r) => r.id));
    if (rows.length < pageSize) return ids;
  }
}

async function insertBatch(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`notifications: HTTP ${res.status} ${await res.text()}`);
}

const userIds = await listAllUserIds();
if (!userIds.length) {
  console.log("Aucun utilisateur — rien à envoyer.");
  process.exit(0);
}

console.log(`Envoi de « ${title} » à ${userIds.length} client(s)…`);
const BATCH = 500;
for (let i = 0; i < userIds.length; i += BATCH) {
  const rows = userIds.slice(i, i + BATCH).map((user_id) => ({
    user_id,
    kind: "broadcast",
    title,
    body: body ?? null,
  }));
  await insertBatch(rows);
  console.log(`  ${Math.min(i + BATCH, userIds.length)}/${userIds.length}`);
}
console.log("✅ Annonce envoyée. Elle apparaîtra dans la cloche du sidepanel de chaque client.");
