import 'server-only';
/**
 * A7 tenant analytics (stretch): the funnel from application to confirmed receipt, time to decision, officer workload,
 * complaints by helper and consent withdrawals, filtered by date and district. Aggregates only — no citizen appears.
 * Districts are those of the applicant (citizens.district_id); every query is scoped to the actor's tenant.
 */
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';

export type AnalyticsFilter = { tenantId: string; from: Date; to: Date; district?: string | null };

const FUNNEL = [
  { step: 'applied', label: 'Applications started', when: sql`true` },
  { step: 'submitted', label: 'Submitted', when: sql`c.submitted_at is not null` },
  { step: 'decided', label: 'Decided', when: sql`c.current_decision_id is not null` },
  { step: 'approved', label: 'Approved', when: sql`c.status in ('approved_on_hold','approved','paid','confirmed','disputed')` },
  { step: 'paid', label: 'Paid', when: sql`c.status in ('paid','confirmed','disputed')` },
  { step: 'confirmed', label: 'Receipt confirmed in full', when: sql`c.status = 'confirmed'` },
] as const;

export async function tenantAnalytics(db: DbOrTx, f: AnalyticsFilter) {
  // ISO strings with a cast: the driver runs without type fetching on the local database and cannot serialise Date parameters
  const fromTs = sql`${f.from.toISOString()}::timestamptz`;
  const toTs = sql`${f.to.toISOString()}::timestamptz`;
  const district = f.district ? sql`and d.code = ${f.district}` : sql``;
  const from = sql`from cases c left join citizens z on z.id = c.citizen_id left join districts d on d.id = z.district_id`;
  const where = sql`where c.tenant_id = ${f.tenantId} and c.created_at >= ${fromTs} and c.created_at < ${toTs} ${district}`;
  const base = sql`${from} ${where}`;

  const funnelRow = rowsOf<Record<string, number>>(await db.execute(sql`select ${sql.join(FUNNEL.map((s) => sql`count(*) filter (where ${s.when})::int as ${sql.identifier(s.step)}`), sql`, `)} ${base}`))[0] ?? {};
  const funnel = FUNNEL.map((s, i) => {
    const n = Number(funnelRow[s.step] ?? 0);
    const prev = i === 0 ? n : Number(funnelRow[FUNNEL[i - 1]!.step] ?? 0);
    return { step: s.step, label: s.label, n, fromPrevious: i === 0 ? null : prev ? Math.round((n / prev) * 1000) / 1000 : null };
  });

  // time from submission to the first decision, and to the officer's decision when there was one
  const ttd = rowsOf<{ p50_auto: number | null; p90_auto: number | null; p50_officer: number | null; p90_officer: number | null; n: number }>(await db.execute(sql`
    with first_dec as (
      select c.id, c.submitted_at,
        min(x.created_at) as first_at,
        min(x.created_at) filter (where x.actor_type = 'officer') as officer_at
      ${from} left join lateral (select created_at, actor_type from decisions where case_id = c.id) x on true
      ${where} and c.submitted_at is not null
      group by c.id, c.submitted_at)
    select count(first_at)::int as n,
      percentile_cont(0.5) within group (order by extract(epoch from first_at - submitted_at) / 60) as p50_auto,
      percentile_cont(0.9) within group (order by extract(epoch from first_at - submitted_at) / 60) as p90_auto,
      percentile_cont(0.5) within group (order by extract(epoch from officer_at - submitted_at) / 3600) as p50_officer,
      percentile_cont(0.9) within group (order by extract(epoch from officer_at - submitted_at) / 3600) as p90_officer
    from first_dec where first_at is not null`))[0];

  const workload = rowsOf<{ officer: string; open: number; decided: number }>(await db.execute(sql`
    select u.display_name as officer,
      count(*) filter (where c.status in ('in_review','needs_proof','frozen','disputed'))::int as open,
      count(*) filter (where exists (select 1 from decisions x where x.case_id = c.id and x.actor_type = 'officer' and x.actor_id = u.id::text))::int as decided
    ${from} join users u on u.id = c.assigned_officer_id
    ${where} and c.assigned_officer_id is not null
    group by u.display_name order by open desc, decided desc limit 20`));

  const complaintDistrict = f.district ? sql`and d.code = ${f.district}` : sql``;
  const byHelper = rowsOf<{ helper: string; complaints: number; deduction: number; open: number }>(await db.execute(sql`
    select coalesce(u.display_name, 'no helper') as helper, count(*)::int as complaints,
      count(*) filter (where k.type = 'deduction')::int as deduction, count(*) filter (where k.status <> 'resolved')::int as open
    from complaints k left join users u on u.id = k.helper_user_id
      left join citizens z on z.id = k.citizen_id left join districts d on d.id = z.district_id
    where k.tenant_id = ${f.tenantId} and k.created_at >= ${fromTs} and k.created_at < ${toTs} ${complaintDistrict}
    group by 1 order by complaints desc limit 20`));

  const withdrawals = rowsOf<{ day: string; n: number }>(await db.execute(sql`
    select to_char(date_trunc('day', s.withdrawn_at), 'YYYY-MM-DD') as day, count(*)::int as n
    from consents s left join citizens z on z.id = s.citizen_id left join districts d on d.id = z.district_id
    where s.tenant_id = ${f.tenantId} and s.status = 'withdrawn' and s.withdrawn_at >= ${fromTs} and s.withdrawn_at < ${toTs} ${complaintDistrict}
    group by 1 order by 1`));

  const districts = rowsOf<{ code: string; name: string }>(await db.execute(sql`select code, name from districts where tenant_id = ${f.tenantId} order by name`));

  const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  return {
    filter: { from: f.from.toISOString(), to: f.to.toISOString(), district: f.district ?? null },
    districts,
    funnel,
    timeToDecision: {
      decided: ttd?.n ?? 0,
      automaticMinutes: { p50: num(ttd?.p50_auto), p90: num(ttd?.p90_auto) },
      officerHours: { p50: num(ttd?.p50_officer), p90: num(ttd?.p90_officer) },
    },
    officerWorkload: workload,
    complaintsByHelper: byHelper,
    consentWithdrawals: { total: withdrawals.reduce((s, w) => s + w.n, 0), byDay: withdrawals },
  };
}
