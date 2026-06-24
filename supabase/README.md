# EMPIR Copilot — Backend Supabase

Backend qui sert l'extension :
- **Auth** : Google OAuth + email/password (Supabase Auth natif)
- **Postgres** : profils, biens sauvegardés, notifications, log d'usage
- **Edge Functions** : `track-usage`, `resolve-address`, `analyze`

## Setup local

```bash
# 1. Installer la CLI
brew install supabase/tap/supabase  # ou : npx supabase

# 2. Démarrer la stack locale (Postgres + GoTrue + Studio + Edge Runtime)
supabase start

# 3. Appliquer les migrations
supabase db reset       # repart de zéro + applique migrations/

# 4. Lancer les Edge Functions
supabase functions serve

# 5. Variables d'env pour les Edge Functions (.env.local à créer)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

## Setup cloud

1. Créer un projet sur https://supabase.com/dashboard
2. Lier le repo :
   ```bash
   supabase link --project-ref <ref>
   ```
3. Push migrations et functions :
   ```bash
   supabase db push
   supabase functions deploy track-usage resolve-address analyze
   ```
4. Configurer le provider Google OAuth dans le dashboard (Auth → Providers).

## Synchronisation avec `packages/core`

Le module `resolve-address` réplique la logique de `packages/core/src/resolver/`
pour éviter les imports ESM workspace dans Deno. **Tout changement d'algorithme
doit être propagé aux deux endroits** (et le scorer reste testé via Vitest dans
`packages/core/`).

## Tables

| Table | Usage | RLS |
|---|---|---|
| `users_profile` | Profil + plan (free/unlimited) | self-read/update |
| `usage_log` | Log analyses pour quota | service-role only |
| `saved_listings` | Biens sauvegardés via cœur ❤️ | self-all |
| `notifications` | Alertes utilisateur | self-all |
| `address_cache` | Cache mutualisé ADEME → adresses | service-role only |
