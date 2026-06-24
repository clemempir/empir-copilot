-- EMPIR Copilot — schéma initial
-- Crée : profils utilisateur, log d'usage (quota freemium), biens sauvegardés,
-- notifications. RLS strict : chaque user ne voit que ses propres lignes.

-- ─── users_profile ─────────────────────────────────────────────────────────
create table public.users_profile (
  id              uuid primary key references auth.users on delete cascade,
  email           text,
  phone           text,
  phone_verified  boolean not null default false,
  plan            text not null default 'free' check (plan in ('free', 'unlimited')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users_profile (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── usage_log ─────────────────────────────────────────────────────────────
-- Une ligne par analyse facturée (résolution d'adresse). Utilisé pour
-- enforcer la limite freemium 15 analyses/30j.
create table public.usage_log (
  id               bigserial primary key,
  user_id          uuid references auth.users on delete set null,
  device_hash      text,
  ip_hash          text,
  listing_url      text not null,
  resolved_address text,
  confidence       integer,
  created_at       timestamptz not null default now()
);
create index usage_log_user_recent_idx on public.usage_log (user_id, created_at desc);
create index usage_log_device_recent_idx on public.usage_log (device_hash, created_at desc);

-- ─── saved_listings ────────────────────────────────────────────────────────
create table public.saved_listings (
  id           bigserial primary key,
  user_id      uuid not null references auth.users on delete cascade,
  listing_url  text not null,
  title        text,
  address      text,
  price        integer,
  score        integer,
  photo_url    text,
  payload      jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, listing_url)
);

-- ─── notifications ─────────────────────────────────────────────────────────
create table public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_recent_idx on public.notifications (user_id, created_at desc);

-- ─── address_cache (mutualisation de la résolution ADEME entre users) ──────
-- Évite de re-requêter ADEME pour deux annonces qui correspondent au même
-- couple (postal_code, surface, dpe_kwh_m2). TTL effectif géré applicativement
-- (clé tronquée par bucket pour limiter la cardinalité).
create table public.address_cache (
  key         text primary key,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table public.users_profile  enable row level security;
alter table public.saved_listings enable row level security;
alter table public.notifications  enable row level security;
-- usage_log et address_cache ne sont jamais accédés depuis le client : RLS off
-- avec service role uniquement (Edge Functions). Pour les Edge Functions, on
-- utilise le service-role key qui contourne RLS.

create policy "users_profile_self_read"   on public.users_profile  for select using (id = auth.uid());
create policy "users_profile_self_update" on public.users_profile  for update using (id = auth.uid());

create policy "saved_listings_self_all"   on public.saved_listings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications_self_all"    on public.notifications  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
