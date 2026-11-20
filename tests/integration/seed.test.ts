import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  citizens, helperAssignments, mockIdentityRecords, mockIssuerKeys, modelVersions, policyChunks, programs, ruleSets, users,
} from '@/db/schema/all';
import { seedCore } from '@/services/seed/core';
import { seedGenerated } from '@/services/seed/generated';
import { verifyChain } from '@/lib/audit';
import { TEST_PASSWORD, TEST_PIN } from '../helpers/api';
import { createTestDb, type TestDb } from '../helpers/pglite';

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });

describe('seeds run clean (G1)', () => {
  it('loads core and generated data, twice (idempotent)', async () => {
    for (let i = 0; i < 2; i++) {
      const ids = await seedCore(t.db, { staffPassword: TEST_PASSWORD, citizenPin: TEST_PIN });
      const counts = await seedGenerated(t.db, ids);
      expect(counts.identity).toBeGreaterThan(1000);
      expect(counts.families).toBe(118);
    }
    const [reg] = await t.db.select({ n: count() }).from(mockIdentityRecords);
    expect(reg!.n).toBeGreaterThan(1000);
    // every mock CNIC uses the never-issued 00000 prefix
    const [badCnic] = await t.db.select({ n: count() }).from(mockIdentityRecords).where(sql`${mockIdentityRecords.cnic} not like '00000-%'`);
    expect(badCnic!.n).toBe(0);
    // staff use .test addresses only; phones only the fictional +9200000 range
    const [badEmail] = await t.db.select({ n: count() }).from(users).where(sql`${users.email} is not null and ${users.email} not like '%.test'`);
    const [badPhone] = await t.db.select({ n: count() }).from(users).where(sql`${users.phone} is not null and ${users.phone} not like '+9200000%'`);
    expect(badEmail!.n + badPhone!.n).toBe(0);
  });

  it('v3 is the published, active rule set in every tenant', async () => {
    const rows = await t.db.select({ version: ruleSets.version, status: ruleSets.status, active: programs.activeRuleSetId, id: ruleSets.id })
      .from(ruleSets).innerJoin(programs, eq(programs.id, ruleSets.programId));
    const published = rows.filter((r) => r.status === 'published');
    expect(published).toHaveLength(3);
    expect(published.every((r) => r.version === 3 && r.active === r.id)).toBe(true);
  });

  it('three helpers each have 40 active families (cap enforced by trigger)', async () => {
    const rows = await t.db.select({ helper: users.email, n: count() }).from(helperAssignments)
      .innerJoin(users, eq(users.id, helperAssignments.helperUserId)).where(eq(helperAssignments.status, 'active')).groupBy(users.email);
    expect(Object.fromEntries(rows.map((r) => [r.helper, r.n]))).toEqual({
      'helper.shabana@sindh.amanat.test': 40, 'helper.kashif@sindh.amanat.test': 40, 'helper.nadia@punjab.amanat.test': 40,
    });
    // a 41st active family is refused by the database
    const [extra] = await t.db.select({ id: citizens.id }).from(citizens).where(sql`${citizens.id} not in (select citizen_id from helper_assignments where helper_user_id = (select id from users where email = 'helper.nadia@punjab.amanat.test'))`).limit(1);
    const [nadia] = await t.db.select({ id: users.id }).from(users).where(eq(users.email, 'helper.nadia@punjab.amanat.test'));
    const [tenant] = await t.db.select({ tenantId: helperAssignments.tenantId }).from(helperAssignments).where(eq(helperAssignments.helperUserId, nadia!.id)).limit(1);
    await expect(t.db.insert(helperAssignments).values({ tenantId: tenant!.tenantId, helperUserId: nadia!.id, citizenId: extra!.id, status: 'active', expiresAt: new Date(Date.now() + 86_400_000) }))
      .rejects.toThrow();
  });

  it('policy clauses, model artifacts and the issuer key are loaded', async () => {
    const [chunks] = await t.db.select({ n: count() }).from(policyChunks);
    expect(chunks!.n).toBe(19);
    const models = await t.db.select({ kind: modelVersions.kind, version: modelVersions.version }).from(modelVersions);
    expect(models.map((m) => `${m.kind}:${m.version}`).sort()).toEqual(['matcher:matcher-v1', 'scorer:scorer-v1']);
    const keys = await t.db.select().from(mockIssuerKeys);
    expect(keys[0]?.kid).toBe('mock-issuer-2026');
  });

  it('the global audit chain verifies after seeding', async () => {
    expect((await verifyChain(t.db, 'global')).intact).toBe(true);
  });
});
