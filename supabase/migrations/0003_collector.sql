-- ============================================================================
-- EMPIR — Banc d'essai : schéma Supabase (Postgres)
-- Tables : cases (dossiers de cas / flight recorder), labels (verdicts), seen (dédup)
-- À exécuter dans Supabase > SQL Editor.
-- ============================================================================

-- 1) Dossiers de cas -----------------------------------------------------------
create table if not exists public.cases (
  id              text primary key,           -- ex: "bi-immo-facile-59810271"
  portal          text not null,              -- bienici | leboncoin | seloger
  listing_id      text not null,              -- id natif de l'annonce
  listing_url     text,
  agency          text,
  ref             text,                       -- référence agence
  property_type   text,                       -- maison | appartement | immeuble
  city            text,
  postal_code     text,
  extracted       jsonb not null,             -- tous les champs extraits (+ marqueur)
  resolved        jsonb,                       -- {address, lat, lon, confidence, status, ademeCertId, parcelId}
  candidates      jsonb default '[]'::jsonb,   -- candidats ADEME alternatifs
  score_breakdown jsonb default '[]'::jsonb,   -- détail du score (explicabilité)
  pseudo_label    jsonb,                       -- {agree, method}  (accord des voies)
  photos          jsonb default '[]'::jsonb,
  snapshot        jsonb,                       -- réponse brute de l'annonce (rejouabilité)
  status          text default 'pending_resolution', -- pending_resolution | confirmed | probable | unresolved | error
  algo_version    text,                        -- SHA git de l'algo au moment du run
  error           text,                        -- message si échec pipeline
  collected_at    timestamptz default now()
);

create index if not exists cases_status_idx      on public.cases (status);
create index if not exists cases_portal_type_idx  on public.cases (portal, property_type);
create index if not exists cases_collected_idx    on public.cases (collected_at desc);

-- 2) Verdicts de revue manuelle -----------------------------------------------
create table if not exists public.labels (
  case_id          text primary key references public.cases(id) on delete cascade,
  verdict          text not null,             -- correct | wrong | fixed | unresolvable_ok
  corrected_address text,
  note             text,
  reviewed_at      timestamptz default now()
);

-- 3) Dédup : annonces déjà vues -----------------------------------------------
create table if not exists public.seen (
  listing_id  text not null,
  portal      text not null,
  first_seen  timestamptz default now(),
  primary key (portal, listing_id)
);

-- ============================================================================
-- Sécurité (simple, usage perso)
--  - Le FEEDER écrit avec la SERVICE ROLE KEY (bypass RLS) côté serveur.
--  - La CONSOLE lit/écrit les labels avec l'ANON KEY → on autorise ça via RLS.
-- ============================================================================
alter table public.cases  enable row level security;
alter table public.labels enable row level security;

-- Lecture des cas pour la console (anon)
drop policy if exists cases_read_anon on public.cases;
create policy cases_read_anon on public.cases for select using (true);

-- La console pose/modifie les labels (anon)
drop policy if exists labels_rw_anon on public.labels;
create policy labels_rw_anon on public.labels for all using (true) with check (true);

-- (cases en écriture : réservé à la service role → pas de policy insert/update pour anon)
