-- EMPIR — tampon de pages brutes pour les portails protégés (SeLoger, LBC).
-- Le navigateur (vraie session, passe DataDome) POST le HTML ici avec la clé
-- anon ; l'ingestion locale (service role) parse puis purge.
create table if not exists public.raw_pages (
  id          text primary key,          -- pathname de l'annonce
  portal      text not null,             -- seloger | leboncoin
  url         text not null,
  html        text not null,
  created_at  timestamptz default now()
);

alter table public.raw_pages enable row level security;

-- Le navigateur (anon) ne peut qu'INSÉRER/mettre à jour sa page — jamais lire.
drop policy if exists raw_pages_insert_anon on public.raw_pages;
create policy raw_pages_insert_anon on public.raw_pages
  for insert with check (true);
drop policy if exists raw_pages_update_anon on public.raw_pages;
create policy raw_pages_update_anon on public.raw_pages
  for update using (true) with check (true);

grant insert, update on public.raw_pages to anon;
grant select, insert, update, delete on public.raw_pages to service_role;
