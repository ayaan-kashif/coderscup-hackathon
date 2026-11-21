import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { getDb } from '@/db/client';
import { citizens, districts, scamAlerts } from '@/db/schema/all';
import type { RouteDef } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { notifyCitizen } from './notify';
import { loadAlertRef } from './refs';

const params = z.object({ id: z.string().max(64) });

/** SCAM-6: approve (broadcast to the district by in-app, mock SMS and voice) or dismiss a drafted alert */
export function alertDecisionSpec(approve: boolean): RouteDef<undefined, undefined, z.infer<typeof params>> {
  const verb = approve ? 'approve' : 'dismiss';
  return {
    operationId: `${verb}ScamAlert`, method: 'POST', path: `/api/v1/scam/alerts/{id}/${verb}`, summary: `${approve ? 'Approve and broadcast' : 'Dismiss'} a district scam alert`, tags: ['Scams'],
    auth: 'required', params, idempotency: 'optional',
    authorize: { action: 'scam.alert.approve', resource: (c, db) => loadAlertRef(db, c.params.id) },
    audit: { action: `scam.alert.${verb}`, resourceType: 'scam_alert' },
    handler: async (c, db) => {
      const [a] = await db.select().from(scamAlerts).where(eq(scamAlerts.id, c.params.id)).for('update').limit(1);
      if (a!.status !== 'draft') throw new ApiError('CASE_STATE', `This alert is ${a!.status}.`);
      await db.update(scamAlerts).set({ status: approve ? 'sent' : 'dismissed', approvedBy: c.actor!.id, sentAt: approve ? new Date() : null }).where(eq(scamAlerts.id, a!.id));
      if (approve) c.afterCommit(() => broadcast(getDb(), a!.tenantId, a!.districtId));
      return { body: { id: a!.id, status: approve ? 'sent' : 'dismissed' }, audit: { details: { districtId: a!.districtId, count: a!.count } } };
    },
  };
}

async function broadcast(db: DbOrTx, tenantId: string, districtId: string) {
  const [d] = await db.select({ name: districts.name }).from(districts).where(eq(districts.id, districtId)).limit(1);
  const people = await db.select({ id: citizens.id }).from(citizens).where(and(eq(citizens.districtId, districtId), isNotNull(citizens.userId))).limit(200);
  for (const p of people) await notifyCitizen(db, { tenantId, citizenId: p.id, key: 'scam_alert', vars: { district: d?.name ?? '' } }).catch(() => {});
}
