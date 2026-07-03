-- L'upsert PostgREST (ON CONFLICT) exige SELECT : pages publiques, pas de
-- sensibilité — on ouvre la lecture anon sur le tampon.
grant select on public.raw_pages to anon;
drop policy if exists raw_pages_select_anon on public.raw_pages;
create policy raw_pages_select_anon on public.raw_pages for select using (true);
