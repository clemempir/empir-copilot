# EMPIR — Banc d'essai : collecte, résolution locale, revue

Collecte autonome d'annonces Bien'ici sur **Saint-Sever (40500)** et **Mont-de-Marsan (40000)**,
types **maison / appartement / immeuble** (pas de terrain), pour alimenter la console de revue
et la boucle d'amélioration de l'algo.

## La boucle complète

```
GitHub Action (quotidien)          En local                     Toi
┌─────────────────────┐   ┌──────────────────────┐   ┌────────────────────┐
│ bienici-feeder.mjs  │ → │ pnpm resolve-pending │ → │ review-console.html│
│ collecte → `cases`  │   │ algo LOCAL du repo   │   │ verdicts → `labels`│
│ (pending_resolution)│   │ (à jour, sans quota) │   │                    │
└─────────────────────┘   └──────────────────────┘   └────────────────────┘
                                    ↑                          │
                                    └── améliorations d'algo ──┘
                                        guidées par les labels
```

1. **Collecte** : `bienici-feeder.mjs` pagine l'API publique Bien'ici, dédup (`seen`),
   récupère la fiche riche (DPE chiffré, date, blurInfo) et écrit un **dossier de cas**
   complet dans Supabase (`cases`, statut `pending_resolution`).
2. **Résolution locale** : `pnpm resolve-pending` résout les cas en attente avec l'algo
   **du repo** (`packages/core`) — pas l'edge function déployée. Aucune limite de quota,
   et on mesure toujours la dernière version du code. `--replay` re-résout TOUS les cas
   (à lancer après chaque changement d'algo pour re-mesurer).
3. **Revue** : `review-console.html` (ouvrir dans le navigateur) charge les cas depuis
   Supabase et enregistre tes verdicts (`correct` / `wrong` / `fixed` / `unresolvable_ok`)
   dans la table `labels`.
4. **Amélioration** : les cas `wrong`/`fixed` deviennent des cas de régression dans
   `packages/core/src/resolver/__corpus.live.test.ts` et guident les corrections d'algo.

Bien'ici = API publique, **pas de DataDome** → tourne sans risque de blocage en cloud.
⚠️ Ne pas ajouter Leboncoin/SeLoger ici (IP datacenter bloquée). Eux passeront par l'extension.

## Mise en place

**1. Base de données** — déjà en place : les tables `cases`, `labels`, `seen` sont créées
par les migrations `supabase/migrations/0003_collector.sql` + `0004_collector_grants.sql`
(`supabase db push`). `schema.sql` reste la référence lisible.

**2. Lancer en local**
```bash
export SUPABASE_URL="https://coqvobufxwurgrsphhnq.supabase.co"
export SUPABASE_SERVICE_KEY="...service_role..."   # supabase projects api-keys
pnpm collect            # collecte (MAX_PER_RUN=60 par défaut)
pnpm resolve-pending    # résout les cas en attente avec l'algo local
```

**3. Automatiser (GitHub Action)** — `.github/workflows/empir-collect.yml` est en place.
Secrets à créer dans Repo → Settings → Secrets → Actions : `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`. Lancement quotidien 06:30 UTC, ou bouton **Run workflow**.

**4. Console de revue** — `collector/review-console.html` : ouvrir dans le navigateur,
c'est branché (clé anon en dur, la RLS encadre les droits). Les verdicts partent dans
`labels` + localStorage en filet.

## Réglages (env)
| Variable | Défaut | Rôle |
|---|---|---|
| `MAX_PER_RUN` | 60 | nb max de **nouvelles** annonces par run |
| `MAX_PAGES` | 12 | garde-fou pagination |
| `DELAY_MS` | 1200 | délai (+ jitter) entre requêtes (politesse) |
| `ALGO_VERSION` | unknown | SHA git de l'algo (mis par l'Action) |
| `RESOLVE_ENDPOINT` | — | edge function (optionnel — la voie normale est `resolve-pending`) |

Les communes/types sont en haut de `bienici-feeder.mjs` (constantes `COMMUNES`, `TYPES`).

## Suite
Quand la collecte tourne et que tu labellises via la console : analyse des modes d'échec
récurrents (Phase 2). Leboncoin/SeLoger viendront via l'extension (Phase 3).
