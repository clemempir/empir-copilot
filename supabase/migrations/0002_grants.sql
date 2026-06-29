-- EMPIR Copilot — grants
--
-- Sur ce projet, les rôles Supabase (`anon`, `authenticated`, `service_role`)
-- n'avaient pas reçu les privilèges CRUD par défaut sur les tables `public.*`.
-- Conséquence : toutes les requêtes des Edge Functions (service_role) et du
-- client (anon/authenticated, encadrées par RLS) renvoyaient 42501 permission
-- denied.
--
-- On rétablit les grants attendus :
--   - `service_role` : ALL sur toutes les tables (RLS bypass).
--   - `anon`, `authenticated` : ALL sur les tables RLS — la RLS reste la seule
--     barrière. usage_log et address_cache restent service-role only (pas de
--     grant explicit aux rôles client).

grant select, insert, update, delete on public.users_profile  to service_role;
grant select, insert, update, delete on public.usage_log      to service_role;
grant select, insert, update, delete on public.saved_listings to service_role;
grant select, insert, update, delete on public.notifications  to service_role;
grant select, insert, update, delete on public.address_cache  to service_role;

grant select, insert, update, delete on public.users_profile  to authenticated;
grant select, insert, update, delete on public.saved_listings to authenticated;
grant select, insert, update, delete on public.notifications  to authenticated;

grant select on public.users_profile to anon;

grant usage, select on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;
