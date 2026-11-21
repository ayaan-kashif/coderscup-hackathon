import { and, eq } from 'drizzle-orm';
import { assertCaseQuota } from './plans';
import type { Actor } from '@/auth/actor';
import { maskCnic } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { cases, citizens, districts, programs } from '@/db/schema/all';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import type { LoadedResource } from '@/lib/api/route';

export type Ticks = 'grey2' | 'blue2';
export const ticksFor = (c: { firstOpenedAt: Date | null }): Ticks => (c.firstOpenedAt ? 'blue2' : 'grey2');

/** Loads only what authorization needs (tenant, citizen) — no personal data before the verdict. */
export async function loadCaseRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await db.select({ id: cases.id, tenantId: cases.tenantId, citizenId: cases.citizenId }).from(cases).where(eq(cases.id, id)).limit(1);
  return c ?? null;
}

/** Which tenant a new case belongs to: the actor's tenant for staff, helpers and API keys; the citizen's district office otherwise. */
export async function tenantForNewCase(db: DbOrTx, actor: Actor, citizenId: string | null) {
  if (actor.tenantId) return actor.tenantId;
  if (!citizenId) throw new ApiError('VALIDATION_FAILED', 'citizenId is required.');
  const [row] = await db.select({ tenantId: districts.tenantId }).from(citizens).leftJoin(districts, eq(districts.id, citizens.districtId)).where(eq(citizens.id, citizenId)).limit(1);
  if (!row?.tenantId) throw new ApiError('VALIDATION_FAILED', 'Your district office could not be found. Choose your district first.');
  return row.tenantId;
}

export async function createDraftCase(db: DbOrTx, p: { actor: Actor; tenantId: string; citizenId: string | null; programCode: string; channel: 'citizen' | 'helper' | 'api' | 'officer'; clientSubmissionId: string }) {
  const [prog] = await db.select({ id: programs.id }).from(programs).where(and(eq(programs.tenantId, p.tenantId), eq(programs.code, p.programCode), eq(programs.active, true))).limit(1);
  if (!prog) throw new ApiError('VALIDATION_FAILED', `Unknown programme ${p.programCode}.`);
  // ADM-4: a repeat of the same submission is not a new case, so it never counts against the plan
  const [dup] = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.tenantId, p.tenantId), eq(cases.clientSubmissionId, p.clientSubmissionId))).limit(1);
  if (!dup) await assertCaseQuota(db, p.tenantId);
  const inserted = await db.insert(cases).values({
    tenantId: p.tenantId, programId: prog.id, citizenId: p.citizenId, status: 'draft', channel: p.channel,
    clientSubmissionId: p.clientSubmissionId, createdByType: p.actor.kind, createdById: p.actor.id,
  }).onConflictDoNothing({ target: [cases.tenantId, cases.clientSubmissionId] }).returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  // OFF-4: the same client submission id is the same case, even under a new Idempotency-Key
  const [existing] = await db.select().from(cases).where(and(eq(cases.tenantId, p.tenantId), eq(cases.clientSubmissionId, p.clientSubmissionId))).limit(1);
  if (existing!.citizenId !== p.citizenId) throw new ApiError('VALIDATION_FAILED', 'clientSubmissionId already used for another application.');
  return { row: existing!, created: false };
}

/** Full case view for staff, with masking from the authorization verdict. */
export async function readCase(db: DbOrTx, id: string, mask: string[] = []) {
  const [row] = await db.select({
    id: cases.id, tenantId: cases.tenantId, status: cases.status, route: cases.route, priority: cases.priority, channel: cases.channel,
    createdAt: cases.createdAt, submittedAt: cases.submittedAt, firstOpenedAt: cases.firstOpenedAt, assignedOfficerId: cases.assignedOfficerId,
    citizenId: citizens.id, name: citizens.nameDisplay, cnicLast4: citizens.cnicLast4, dob: citizens.dob, gender: citizens.gender,
  }).from(cases).leftJoin(citizens, eq(citizens.id, cases.citizenId)).where(eq(cases.id, id)).limit(1);
  if (!row) return null;
  const hide = new Set(mask);
  return {
    id: row.id, tenantId: row.tenantId, status: row.status, route: row.route, priority: row.priority, channel: row.channel,
    createdAt: row.createdAt, submittedAt: row.submittedAt, ticks: ticksFor(row), assignedOfficerId: row.assignedOfficerId,
    citizen: row.citizenId ? {
      id: row.citizenId,
      name: hide.has('name') ? null : row.name,
      cnic: row.cnicLast4 ? maskCnic(row.cnicLast4) : null, // the full CNIC is never returned by this endpoint
      dob: hide.has('dob') ? null : row.dob,
      gender: row.gender,
    } : null,
    masked: [...hide],
  };
}

/** OQ-5: the first officer to open the case turns the citizen's ticks blue. */
export async function markOpened(db: DbOrTx, id: string, officerId?: string, requestId?: string) {
  const [c] = await db.select({ firstOpenedAt: cases.firstOpenedAt, tenantId: cases.tenantId, citizenId: cases.citizenId }).from(cases).where(eq(cases.id, id)).limit(1);
  if (c && !c.firstOpenedAt) {
    await db.update(cases).set({ firstOpenedAt: new Date() }).where(eq(cases.id, id));
    if (officerId) await writeAudit(db, { requestId, actorType: 'user', actorId: officerId, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'case.open', resourceType: 'case', resourceId: id, outcome: 'allowed', details: { ticks: 'blue2' } });
  }
}
