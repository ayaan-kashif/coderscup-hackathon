import { and, desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { render, TEMPLATES, type TemplateKey } from '@/services/notify';

/** in-app notifications (NOT-2): the citizen's messages, or a staff member's alerts */
export const GET = route({
  operationId: 'listMyNotifications', method: 'GET', path: '/api/v1/me/notifications', summary: 'My in-app messages', tags: ['Notifications'],
  auth: 'required',
  authorize: { action: 'notifications.read' },
  audit: false, transaction: false,
  handler: async (c, db) => {
    const where = c.actor!.role === 'citizen' ? eq(notifications.citizenId, c.actor!.citizenId!) : eq(notifications.userId, c.actor!.id);
    const rows = await db.select().from(notifications).where(and(where, eq(notifications.channel, 'in_app'))).orderBy(desc(notifications.createdAt)).limit(30);
    return {
      body: {
        items: rows.map((r) => {
          const v = r.variables as Record<string, string | number>;
          const voice = (r.variables as { voice?: string[] }).voice ?? [];
          const key = r.templateKey as TemplateKey;
          return { id: r.id, key, createdAt: r.createdAt, en: TEMPLATES[key] ? render(key, v, 'en') : r.templateKey, ur: TEMPLATES[key] ? render(key, { ...v, trust: '' }, 'ur') : '', voice, ref: { caseId: v.caseId ?? null, caseIds: v.caseIds ?? null, paymentId: v.paymentId ?? null, payoutChangeId: v.payoutChangeId ?? null, complaintId: v.complaintId ?? null } };
        }),
      },
    };
  },
});
