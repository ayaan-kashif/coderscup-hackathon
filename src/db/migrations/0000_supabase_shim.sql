-- Extensions and the Supabase objects the later migrations rely on.
-- On Supabase these already exist and every statement below is a no-op;
-- on a bare Postgres (PGlite in tests, CI) they are created so the same migrations run everywhere.
create extension if not exists pgcrypto;
--> statement-breakpoint
create extension if not exists vector;
--> statement-breakpoint
create extension if not exists pg_trgm;
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
--> statement-breakpoint
create schema if not exists auth;
--> statement-breakpoint
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    -- same definition Supabase uses: the JWT subject set by PostgREST / Realtime
    execute $f$
      create function auth.uid() returns uuid language sql stable as
      'select nullif(coalesce(current_setting(''request.jwt.claim.sub'', true),
        (current_setting(''request.jwt.claims'', true)::jsonb ->> ''sub'')), '''')::uuid'
    $f$;
  end if;
end $$;
