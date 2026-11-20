-- Row-level security on every table (PRD §20.4). The browser never queries tables directly, except
-- realtime on notifications and the citizen's own cases rows, which get narrow auth.uid() policies.
-- Everything else goes through the API, which connects as the database owner / service role.
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('public', 'mock') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;
--> statement-breakpoint

-- the mock schema is never reachable from browser roles
revoke all on schema mock from anon, authenticated;
--> statement-breakpoint

create policy cases_citizen_read_own on cases for select to authenticated
  using (citizen_id in (select c.id from citizens c where c.user_id = auth.uid()));
--> statement-breakpoint
create policy notifications_read_own on notifications for select to authenticated
  using (user_id = auth.uid());
--> statement-breakpoint

-- DEC-8: decision rows are immutable; a re-decision is a new row
create or replace function decisions_immutable() returns trigger language plpgsql as $$
begin raise exception 'decisions are immutable; insert a new decision linked by previous_decision_id'; end $$;
--> statement-breakpoint
create trigger trg_decisions_immutable before update or delete on decisions
  for each row execute function decisions_immutable();
--> statement-breakpoint

-- HELP-1: at most 40 active assignments per helper
create or replace function helper_assignment_cap() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and (
    select count(*) from helper_assignments
    where helper_user_id = new.helper_user_id and status = 'active' and id <> new.id
  ) >= 40 then
    raise exception 'helper % already has 40 active assignments', new.helper_user_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger trg_helper_assignment_cap before insert or update of status on helper_assignments
  for each row execute function helper_assignment_cap();
--> statement-breakpoint

-- rule sets are immutable once published (RULE-1); only the status may move published -> retired
create or replace function rule_sets_immutable() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.rules is distinct from old.rules or new.thresholds is distinct from old.thresholds
     or new.costs is distinct from old.costs or new.version is distinct from old.version) then
    raise exception 'published rule sets are immutable';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger trg_rule_sets_immutable before update on rule_sets
  for each row execute function rule_sets_immutable();
--> statement-breakpoint

-- 64-bit difference-hash Hamming distance, for image-reuse checks (DOC-5)
create or replace function dhash_distance(a bigint, b bigint) returns integer language sql immutable as $$
  select bit_count((a # b)::bit(64))::integer
$$;
