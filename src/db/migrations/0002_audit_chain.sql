-- PRD §20.3, as written. Statement breakpoints are added only so the migrator can run one statement at a time.
create extension if not exists pgcrypto;
--> statement-breakpoint

create table audit_chain_heads (chain_id text primary key, last_seq bigint not null default 0,
  last_hash bytea not null default decode(repeat('00', 32), 'hex'));
--> statement-breakpoint

create table audit_events (
  id bigserial primary key,
  chain_id text not null references audit_chain_heads(chain_id),
  seq bigint,                               -- position in the chain, set by the trigger under the head lock
  ts timestamptz not null default now(),
  request_id text,
  actor_type text not null check (actor_type in ('user','system','ai','agent','api_key')),
  actor_id text not null,
  tenant_id uuid,
  subject_citizen_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null check (outcome in ('allowed','denied','error')),
  details jsonb not null default '{}',   -- ids and hashes only, never raw personal data
  prev_hash bytea,
  hash bytea,
  unique (chain_id, seq)
);
--> statement-breakpoint

-- covers every column except the hash itself, so editing any field of a row is detected;
-- a jsonb array keeps nulls and separators unambiguous
create or replace function audit_payload(e audit_events, prev bytea) returns bytea
language sql stable as $$
  select digest(jsonb_build_array(
    encode(prev, 'hex'), e.chain_id, e.seq, e.id,
    (extract(epoch from e.ts) * 1000000)::bigint,
    e.request_id, e.actor_type, e.actor_id, e.tenant_id, e.subject_citizen_id,
    e.action, e.resource_type, e.resource_id, e.outcome, e.details)::text, 'sha256')
$$;
--> statement-breakpoint

create or replace function audit_chain() returns trigger language plpgsql as $$
declare head audit_chain_heads;
begin
  select * into head from audit_chain_heads where chain_id = new.chain_id for update;  -- serialise writers
  new.seq := head.last_seq + 1;            -- assigned under the lock, so chain order never depends on id order
  new.prev_hash := head.last_hash;
  new.hash := audit_payload(new, head.last_hash);
  update audit_chain_heads set last_seq = new.seq, last_hash = new.hash where chain_id = new.chain_id;
  return new;
end $$;
--> statement-breakpoint
create trigger trg_audit_chain before insert on audit_events for each row execute function audit_chain();
--> statement-breakpoint

create or replace function audit_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit_events is append-only'; end $$;
--> statement-breakpoint
create trigger trg_audit_append_only before update or delete on audit_events
  for each row execute function audit_append_only();
--> statement-breakpoint

-- returns the id of the first broken row, -1 if rows are missing from the end, or null if the chain is intact
create or replace function audit_verify(p_chain text) returns bigint language plpgsql as $$
declare r audit_events; prev bytea := decode(repeat('00', 32), 'hex'); expected bigint := 1;
begin
  for r in select * from audit_events where chain_id = p_chain order by seq loop
    if r.seq is distinct from expected                -- a gap means a deleted row
       or r.prev_hash is distinct from prev
       or r.hash is distinct from audit_payload(r, prev) then
      return r.id;
    end if;
    prev := r.hash;
    expected := expected + 1;
  end loop;
  if expected - 1 is distinct from (select last_seq from audit_chain_heads where chain_id = p_chain) then
    return -1;                                        -- rows deleted from the end of the chain
  end if;
  return null;
end $$;
--> statement-breakpoint

-- consent check used by the service layer and by row-level security policies
create or replace function has_active_consent(p_citizen uuid, p_grantee_type text, p_grantee uuid,
  p_purpose text, p_category text) returns boolean language sql stable as $$
  select exists (select 1 from consents
    where citizen_id = p_citizen and grantee_type = p_grantee_type and grantee_id = p_grantee
      and purpose = p_purpose and status = 'active'
      and (expires_at is null or expires_at > now())
      and p_category = any (data_categories))
$$;
--> statement-breakpoint

-- ---- additions around the verbatim block (not changing it) ----

-- pin search_path so digest() resolves on Supabase (pgcrypto lives in the "extensions" schema there)
alter function audit_payload(audit_events, bytea) set search_path = public, extensions, pg_temp;
--> statement-breakpoint
alter function audit_chain() set search_path = public, extensions, pg_temp;
--> statement-breakpoint
alter function audit_verify(text) set search_path = public, extensions, pg_temp;
--> statement-breakpoint

-- chain heads are seeded here: one global chain, plus one per tenant created by a trigger on tenants,
-- so the audit trigger never races to create a head
insert into audit_chain_heads (chain_id) values ('global') on conflict do nothing;
--> statement-breakpoint
create or replace function tenant_chain_head() returns trigger language plpgsql as $$
begin
  insert into audit_chain_heads (chain_id) values ('tenant:' || new.id::text) on conflict do nothing;
  return new;
end $$;
--> statement-breakpoint
create trigger trg_tenant_chain_head after insert on tenants for each row execute function tenant_chain_head();
--> statement-breakpoint

-- §20.4 indexes
create index audit_events_subject_ts on audit_events (subject_citizen_id, ts);
--> statement-breakpoint
create index audit_events_resource on audit_events (resource_type, resource_id);
--> statement-breakpoint
create index audit_events_tenant_ts on audit_events (tenant_id, ts);
