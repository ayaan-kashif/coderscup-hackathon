/**
 * Demo-day fixtures that need the live pipeline (run after the main seed has committed):
 *  - beat 3: Fatima Bibi's case, decided by the real pipeline → stop S1 (two Fatima Bibis in Badin);
 *  - beat 5: five of Helper Shabana's families with draft applications, ready for the shared-wallet anomaly;
 *  - beat 1: recent fake-message reports in Hyderabad, so one more report drafts the district alert.
 * Idempotent: each fixture is keyed (clientSubmissionId "seed-…", message hash "seed-…").
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import type { Actor } from '@/auth/actor';
import type { DbOrTx } from '@/db/client';
import { cases, districts, helperAssignments, scamReports, users } from '@/db/schema/all';
import { createDraftCase } from '../cases';
import { saveAnswers, submitCase } from '../intake';
import { inlineStepper, runCaseProcess } from '../pipeline/run';
import type { seedCore } from './core';

type Ids = Awaited<ReturnType<typeof seedCore>>;

export async function seedDemoCases(db: DbOrTx, ids: Ids) {
  const out: Record<string, unknown> = {};
  const sindh = ids.tenantIds.sindh;

  // ---- beat 3: Fatima, no documents yet → the registry has 15 Fatima Bibis in Badin → S1
  const fatimaId = ids.citizenIds['+920000000002']!;
  const fatimaActor: Actor = { kind: 'user', id: 'seed', role: 'citizen', citizenId: fatimaId, stage: 'full' };
  const f = await createDraftCase(db, { actor: fatimaActor, tenantId: sindh, citizenId: fatimaId, programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'seed-fatima-s1' });
  if (f.row.status === 'draft') {
    await saveAnswers(db, fatimaActor, f.row.id, [
      { question: 'name', value: 'Fatima Bibi', via: 'voice' },
      { question: 'district', value: 'BDN', via: 'icon' },
      { question: 'husband_died', value: true, via: 'icon' },
      { question: 'remarried', value: false, via: 'icon' },
      { question: 'income', value: 9000, via: 'keypad' },
    ]);
    await submitCase(db, f.row.id);
    out.fatima = await runCaseProcess(db, f.row.id, inlineStepper());
  } else out.fatima = { existing: f.row.status };

  // ---- beat 5: five of Shabana's families with draft applications
  const [shabana] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'helper.shabana@sindh.amanat.test')).limit(1);
  const fams = await db.select({ citizenId: helperAssignments.citizenId }).from(helperAssignments)
    .where(and(eq(helperAssignments.helperUserId, shabana!.id), eq(helperAssignments.status, 'active'))).orderBy(helperAssignments.createdAt).limit(12);
  const persona = new Set(Object.values(ids.citizenIds));
  let drafts = 0;
  for (const fam of fams.filter((x) => !persona.has(x.citizenId)).slice(0, 5)) {
    const actor: Actor = { kind: 'user', id: shabana!.id, role: 'helper', tenantId: sindh };
    const r = await createDraftCase(db, { actor, tenantId: sindh, citizenId: fam.citizenId, programCode: 'SAAYA-WS', channel: 'helper', clientSubmissionId: `seed-help-${fam.citizenId.slice(0, 8)}` });
    if (r.created) drafts++;
  }
  out.helperDrafts = drafts;

  // ---- beat 1: recent confirmed fakes in Hyderabad (synthetic), so the live check is the 5th today → spike
  const [hyd] = await db.select({ id: districts.id }).from(districts).where(eq(districts.code, 'HYD')).limit(1);
  await db.delete(scamReports).where(like(scamReports.messageHash, 'seed-%'));
  const now = Date.now();
  const rows = [1, 2, 3, 4].map((h) => ({ at: new Date(now - h * 25 * 60_000), n: h }))
    .concat([{ at: new Date(now - 3 * 86_400_000), n: 5 }]);
  for (const r of rows) {
    await db.insert(scamReports).values({
      tenantId: sindh, districtId: hyd!.id, messageHash: `seed-${r.n}`, messageText: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release. (synthetic seed report)',
      channel: 'text', verdict: 'fake', scamType: 'fee_before_payment', extractedClaims: { synthetic: true }, createdAt: r.at,
    });
  }
  out.scamReports = rows.length;

  // ---- Scam Map pattern (synthetic): confirmed fakes over the last 7 days in the other districts, a mix of types and
  // sizes with some under 3. Hyderabad is left exactly as above. Per district: reports per day, oldest first (today last).
  // No district here reaches 5 today, so only Hyderabad can spike.
  const PATTERN: Record<string, { perDay: number[]; types: string[] }> = {
    KHS: { perDay: [1, 2, 3, 2, 2, 3, 3], types: ['fee_before_payment', 'fake_approval_link', 'asks_pin_code_cnic'] },
    LHR: { perDay: [2, 3, 2, 3, 4, 3, 3], types: ['impersonation_call', 'fee_before_payment', 'lottery_prize'] },
    FSD: { perDay: [1, 1, 2, 1, 2, 1, 2], types: ['fake_registration_drive', 'fee_before_payment'] },
    MUL: { perDay: [0, 1, 1, 1, 0, 1, 1], types: ['fake_approval_link', 'asks_pin_code_cnic'] },
    SKR: { perDay: [0, 1, 0, 1, 1, 1, 1], types: ['lottery_prize', 'fee_before_payment'] },
    TTA: { perDay: [0, 0, 1, 0, 1, 1, 1], types: ['fake_registration_drive'] },
    BWP: { perDay: [0, 0, 1, 0, 0, 0, 1], types: ['impersonation_call'] },
    BDN: { perDay: [0, 0, 0, 1, 0, 0, 1], types: ['fee_before_payment'] },
    RJP: { perDay: [0, 0, 0, 0, 0, 1, 0], types: ['asks_pin_code_cnic'] },
    THP: { perDay: [0, 0, 0, 0, 0, 0, 1], types: ['lottery_prize'] },
  };
  const dists = await db.select({ id: districts.id, code: districts.code, tenantId: districts.tenantId }).from(districts);
  let mapRows = 0;
  for (const d of dists) {
    const p = PATTERN[d.code];
    if (!p || !d.tenantId) continue;
    let k = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < p.perDay[i]!; j++, k++) {
        const at = new Date(now - (6 - i) * 86_400_000 - (j + 1) * 20 * 60_000);
        await db.insert(scamReports).values({
          tenantId: d.tenantId, districtId: d.id, messageHash: `seed-map-${d.code}-${k}`, messageText: '(synthetic seed report for the Scam Map)',
          channel: 'text', verdict: 'fake', scamType: p.types[k % p.types.length]!, extractedClaims: { synthetic: true }, createdAt: at,
        });
        mapRows++;
      }
    }
  }
  out.scamMapReports = mapRows;
  return out;
}

/** used by tests and demo reset to find the seeded cases */
export async function seededCaseIds(db: DbOrTx) {
  const rows = await db.select({ id: cases.id, key: cases.clientSubmissionId }).from(cases).where(inArray(cases.clientSubmissionId, ['seed-fatima-s1']));
  return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}
