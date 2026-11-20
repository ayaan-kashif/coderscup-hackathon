import { and, desc, eq, gte, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditEvents } from '@/db/schema/all';
import { chainIdFor } from '@/lib/audit';

export type AuditSearch = {
  tenantId: string;
  view: 'all' | 'config_events' | 'case_timeline';
  caseId?: string; citizenId?: string; actorId?: string; action?: string; outcome?: 'allowed' | 'denied' | 'error';
  from?: string; to?: string; cursor?: number; limit: number;
};

const CONFIG_ACTIONS = ['config.%', 'chaos.%', 'rules.%', 'twin.%', 'admin.%', 'audit.verify'];

export async function searchAuditEvents(db: DbOrTx, s: AuditSearch) {
  const where: SQL[] = [eq(auditEvents.chainId, chainIdFor(s.tenantId))];
  if (s.view === 'config_events') where.push(or(...CONFIG_ACTIONS.map((a) => like(auditEvents.action, a)))!);
  if (s.view === 'case_timeline' || s.caseId) where.push(and(eq(auditEvents.resourceType, 'case'), eq(auditEvents.resourceId, s.caseId!))!);
  if (s.citizenId) where.push(eq(auditEvents.subjectCitizenId, s.citizenId));
  if (s.actorId) where.push(eq(auditEvents.actorId, s.actorId));
  if (s.action) where.push(like(auditEvents.action, `${s.action.replace(/[%_]/g, '')}%`));
  if (s.outcome) where.push(eq(auditEvents.outcome, s.outcome));
  if (s.from) where.push(gte(auditEvents.ts, new Date(s.from)));
  if (s.to) where.push(lte(auditEvents.ts, new Date(s.to)));
  if (s.cursor) where.push(lt(auditEvents.seq, s.cursor));
  const rows = await db.select({
    id: auditEvents.id, seq: auditEvents.seq, ts: auditEvents.ts, requestId: auditEvents.requestId, actorType: auditEvents.actorType,
    actorId: auditEvents.actorId, subjectCitizenId: auditEvents.subjectCitizenId, action: auditEvents.action, resourceType: auditEvents.resourceType,
    resourceId: auditEvents.resourceId, outcome: auditEvents.outcome, details: auditEvents.details,
    hash: sql<string>`encode(${auditEvents.hash}, 'hex')`, prevHash: sql<string>`encode(${auditEvents.prevHash}, 'hex')`,
  }).from(auditEvents).where(and(...where)).orderBy(desc(auditEvents.seq)).limit(s.limit + 1);
  const more = rows.length > s.limit;
  const events = rows.slice(0, s.limit);
  return { events, nextCursor: more ? events.at(-1)!.seq : null, chain: chainIdFor(s.tenantId) };
}
