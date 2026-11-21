import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/pglite';

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });

const PLATFORM_TABLES = [
  'tenants', 'plans', 'users', 'memberships', 'citizens', 'api_keys', 'helper_assignments', 'helper_grants',
  'programs', 'rule_sets', 'policy_documents', 'policy_chunks', 'cases', 'case_facts', 'documents', 'voice_inputs',
  'identity_matches', 'decisions', 'proof_requests', 'payout_destinations', 'payout_changes', 'payments', 'complaints',
  'consents', 'correction_requests', 'scam_reports', 'scam_alerts', 'districts', 'notifications', 'outbox',
  'webhook_endpoints', 'webhook_deliveries', 'audit_events', 'audit_chain_heads', 'audit_anchors', 'idempotency_keys',
  'ai_calls', 'ai_decisions', 'model_versions', 'twin_runs', 'twin_case_results', 'eval_runs', 'eval_case_results',
  'system_config', 'chaos_settings', 'tts_cache',
];
const MOCK_TABLES = ['identity_records', 'civil_events', 'wallets', 'ledger_transactions', 'sms_messages', 'complaints', 'issuer_keys'];

describe('migrations (PRD §20.2)', () => {
  it('creates exactly the 46 platform tables (45 from §20.2 + the VOICE-2 TTS cache) and the 7 mock tables', async () => {
    expect(PLATFORM_TABLES).toHaveLength(46);
    const res = await t.pg.query<{ schemaname: string; tablename: string }>(
      `select schemaname, tablename from pg_tables where schemaname in ('public','mock') order by 1, 2`);
    const pub = res.rows.filter((r) => r.schemaname === 'public').map((r) => r.tablename).sort();
    const mock = res.rows.filter((r) => r.schemaname === 'mock').map((r) => r.tablename).sort();
    expect(pub).toEqual([...PLATFORM_TABLES].sort());
    expect(mock).toEqual([...MOCK_TABLES].sort());
  });

  it('enables row-level security on every table', async () => {
    const res = await t.pg.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public','mock') and c.relkind = 'r' and not c.relrowsecurity`);
    expect(res.rows).toEqual([]);
  });

  it('seeds the global audit chain head and creates one per tenant', async () => {
    await t.pg.query(`insert into tenants (code, name) values ('t-mig', 'Migration test')`);
    const res = await t.pg.query<{ chain_id: string }>(`select chain_id from audit_chain_heads order by chain_id`);
    expect(res.rows.map((r) => r.chain_id)).toContain('global');
    expect(res.rows.some((r) => r.chain_id.startsWith('tenant:'))).toBe(true);
  });

  it('blocks browser roles from tables without a policy (RLS backstop)', async () => {
    await t.pg.exec(`grant usage on schema public to authenticated; grant select on tenants, cases to authenticated`);
    await t.pg.exec(`set role authenticated`);
    const res = await t.pg.query(`select * from tenants`);
    await t.pg.exec(`reset role`);
    expect(res.rows).toEqual([]);
  });
});
