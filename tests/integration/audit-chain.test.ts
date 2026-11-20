import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyChain, writeAudit } from '@/lib/audit';
import { createTestDb, type TestDb } from '../helpers/pglite';

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });

async function newChain(code: string, n: number) {
  const { rows } = await t.pg.query<{ id: string }>(`insert into tenants (code, name) values ($1, $1) returning id`, [code]);
  const tenantId = rows[0]!.id;
  // concurrent writers: seq is assigned under the head lock, so order never depends on id order
  await Promise.all(Array.from({ length: n }, (_, i) => writeAudit(t.db, {
    actorType: 'system', actorId: 'test', tenantId, action: `act.${i}`, resourceType: 'case', resourceId: String(i), outcome: 'allowed', details: { i },
  })));
  return { tenantId, chainId: `tenant:${tenantId}` };
}

const rowsOf = async (chainId: string) =>
  (await t.pg.query<{ id: number; seq: number }>(`select id, seq from audit_events where chain_id = $1 order by seq`, [chainId])).rows;

/** The guard trigger blocks edits; a database admin can still disable it — and is still caught. */
async function asDbaWithoutGuard(fn: () => Promise<unknown>) {
  await t.pg.exec(`alter table audit_events disable trigger trg_audit_append_only`);
  try { await fn(); } finally { await t.pg.exec(`alter table audit_events enable trigger trg_audit_append_only`); }
}

describe('audit chain (PRD §20.3)', () => {
  it('a fresh chain written concurrently verifies intact with gap-free seq', async () => {
    const { chainId } = await newChain('chain-ok', 25);
    const v = await verifyChain(t.db, chainId);
    expect(v).toMatchObject({ intact: true, brokenAt: null, missingTail: false, length: 25 });
    expect((await rowsOf(chainId)).map((r) => Number(r.seq))).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('rejects updates and deletes through the append-only guard', async () => {
    const { chainId } = await newChain('chain-guard', 2);
    await expect(t.pg.query(`update audit_events set action = 'x' where chain_id = $1`, [chainId])).rejects.toThrow(/append-only/);
    await expect(t.pg.query(`delete from audit_events where chain_id = $1`, [chainId])).rejects.toThrow(/append-only/);
  });

  it.each([
    ['action', `action = 'forged'`],
    ['tenant_id', `tenant_id = gen_random_uuid()`],
    ['subject_citizen_id', `subject_citizen_id = gen_random_uuid()`],
    ['details', `details = '{"i": 999}'`],
    ['ts', `ts = ts + interval '1 second'`],
    ['outcome', `outcome = 'denied'`],
  ])('detects an edit to %s at exactly that row', async (col, setClause) => {
    const { chainId } = await newChain(`chain-edit-${col}`, 8);
    const target = (await rowsOf(chainId))[4]!;
    await asDbaWithoutGuard(() => t.pg.query(`update audit_events set ${setClause} where id = $1`, [target.id]));
    const v = await verifyChain(t.db, chainId);
    expect(v.intact).toBe(false);
    expect(v.brokenAt).toBe(Number(target.id));
  });

  it('detects a deleted row in the middle (gap in seq)', async () => {
    const { chainId } = await newChain('chain-del-mid', 6);
    const rows = await rowsOf(chainId);
    await asDbaWithoutGuard(() => t.pg.query(`delete from audit_events where id = $1`, [rows[2]!.id]));
    const v = await verifyChain(t.db, chainId);
    expect(v.brokenAt).toBe(Number(rows[3]!.id));
  });

  it('detects rows deleted from the end of the chain', async () => {
    const { chainId } = await newChain('chain-del-tail', 6);
    const rows = await rowsOf(chainId);
    await asDbaWithoutGuard(() => t.pg.query(`delete from audit_events where id = $1`, [rows[5]!.id]));
    const v = await verifyChain(t.db, chainId);
    expect(v).toMatchObject({ intact: false, missingTail: true, brokenAt: null });
  });
});

describe('has_active_consent', () => {
  it('is true only for an active, unexpired consent covering the purpose and category', async () => {
    const q = async (sqlText: string, p: unknown[] = []) => (await t.pg.query<Record<string, unknown>>(sqlText, p)).rows;
    const [tenant] = await q(`insert into tenants (code, name) values ('consent-t', 'c') returning id`);
    const [cit] = await q(`insert into citizens (cnic_enc, cnic_hash, cnic_last4, name_display, name_norm) values ('\\x00', 'h-consent', '0002', 'Test', 'test') returning id`);
    const args = [cit!.id, tenant!.id];
    await q(`insert into consents (citizen_id, tenant_id, grantee_type, grantee_id, purpose, data_categories, method, notice_version)
             values ($1, $2, 'tenant', $2, 'eligibility_verification', '{identity,documents}', 'voice_pin', 'v1')`, args);
    const check = async (purpose: string, cat: string) =>
      (await q(`select has_active_consent($1, 'tenant', $2, $3, $4) as ok`, [...args, purpose, cat]))[0]!.ok;
    expect(await check('eligibility_verification', 'documents')).toBe(true);
    expect(await check('eligibility_verification', 'payments')).toBe(false);
    expect(await check('marketing', 'documents')).toBe(false);
    await q(`update consents set status = 'withdrawn', withdrawn_at = now() where citizen_id = $1`, [cit!.id]);
    expect(await check('eligibility_verification', 'documents')).toBe(false);
    await q(`insert into consents (citizen_id, tenant_id, grantee_type, grantee_id, purpose, data_categories, method, notice_version, expires_at)
             values ($1, $2, 'tenant', $2, 'eligibility_verification', '{documents}', 'voice_pin', 'v1', now() - interval '1 minute')`, args);
    expect(await check('eligibility_verification', 'documents')).toBe(false);
  });
});

describe('other database guards', () => {
  it('decisions are immutable', async () => {
    const q = async (s: string, p: unknown[] = []) => (await t.pg.query<Record<string, unknown>>(s, p)).rows;
    const [tenant] = await q(`insert into tenants (code, name) values ('dec-t', 'd') returning id`);
    const [prog] = await q(`insert into programs (tenant_id, code, name, benefit_amount, frequency) values ($1, 'SAAYA-WS', 'Saaya', 12000, 'quarterly') returning id`, [tenant!.id]);
    const [c] = await q(`insert into cases (tenant_id, program_id, client_submission_id, channel, created_by_type, created_by_id) values ($1, $2, 'x', 'api', 'system', 's') returning id`, [tenant!.id, prog!.id]);
    const [d] = await q(`insert into decisions (case_id, tenant_id, outcome, proposed_action, input_hash, snapshot, rule_trace, actor_type, actor_id)
                         values ($1, $2, 'OFFICER_REVIEW', 'review', 'h', '{}', '[]', 'system', 's') returning id`, [c!.id, tenant!.id]);
    await expect(q(`update decisions set outcome = 'AUTO_APPROVE' where id = $1`, [d!.id])).rejects.toThrow(/immutable/);
  });
});
