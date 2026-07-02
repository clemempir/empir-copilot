-- EMPIR — grants pour le banc d'essai collecteur (cases, labels, seen)
--
-- Même convention que 0002_grants.sql : les rôles n'ont pas de privilèges CRUD
-- par défaut sur ce projet.
--   - `service_role` : ALL (feeder + resolve-pending, bypass RLS).
--   - `anon` : lecture des cas + lecture/écriture des labels (console de revue,
--     encadré par les policies RLS de 0003_collector.sql).

grant select, insert, update, delete on public.cases  to service_role;
grant select, insert, update, delete on public.labels to service_role;
grant select, insert, update, delete on public.seen   to service_role;

grant select on public.cases to anon;
grant select, insert, update, delete on public.labels to anon;
