import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import { auditEvents } from '@/db/schema/all';

export type AuditActorType = 'user' | 'system' | 'ai' | 'agent' | 'api_key';

export type AuditInput = {
  requestId?: string | null;
  actorType: AuditActorType;
  actorId: string;
  tenantId?: string | null;
  subjectCitizenId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  /** ids, hashes and codes only — never raw personal data */
  details?: Record<string, unknown>;
};

export const chainIdFor = (tenantId?: string | null) => (tenantId ? `tenant:${tenantId}` : 'global');

/** Appends one event. seq, prev_hash and hash are set by the database trigger, never by the app. */
export async function writeAudit(db: DbOrTx, e: AuditInput) {
  const [row] = await db.insert(auditEvents).values({
    chainId: chainIdFor(e.tenantId),
    requestId: e.requestId ?? null,
    actorType: e.actorType,
    actorId: e.actorId,
    tenantId: e.tenantId ?? null,
    subjectCitizenId: e.subjectCitizenId ?? null,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    outcome: e.outcome,
    details: e.details ?? {},
  }).returning({ id: auditEvents.id, seq: auditEvents.seq });
  return row!;
}

export type VerifyResult = { chainId: string; intact: boolean; brokenAt: number | null; missingTail: boolean; length: number };

/** Runs audit_verify(): null = intact, -1 = rows missing from the end, otherwise the first broken row id. */
export async function verifyChain(db: DbOrTx, chainId: string): Promise<VerifyResult> {
  const res = await db.execute<{ broken: string | number | null; len: string | number | null }>(
    sql`select audit_verify(${chainId}) as broken, (select last_seq from audit_chain_heads where chain_id = ${chainId}) as len`);
  const r = rowsOf<{ broken: string | number | null; len: string | number | null }>(res)[0];
  if (!r || r.len === null) throw new Error(`unknown chain ${chainId}`);
  const broken = r.broken === null ? null : Number(r.broken);
  return { chainId, intact: broken === null, brokenAt: broken !== null && broken > 0 ? broken : null, missingTail: broken === -1, length: Number(r.len) };
}
