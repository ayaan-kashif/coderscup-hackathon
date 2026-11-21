import { z } from 'zod';
import { route } from '@/lib/api/route';
import { tenantAnalytics } from '@/services/analytics';

const query = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  district: z.string().regex(/^[A-Z]{2,5}$/).optional(),
});

/** A7: programme analytics for this office (aggregates only), by date range and district */
export const GET = route({
  operationId: 'getTenantAnalytics', method: 'GET', path: '/api/v1/admin/analytics', summary: 'Funnel, time to decision, workload, complaints by helper, withdrawals', tags: ['Admin'],
  auth: 'required', query, authorize: { action: 'config.read' }, audit: false, transaction: false,
  handler: async (c, db) => {
    const to = c.query.to ? new Date(`${c.query.to}T00:00:00Z`) : new Date();
    const end = c.query.to ? new Date(to.getTime() + 86_400_000) : to;
    const from = c.query.from ? new Date(`${c.query.from}T00:00:00Z`) : new Date(end.getTime() - 90 * 86_400_000);
    return { body: await tenantAnalytics(db, { tenantId: c.actor!.tenantId!, from, to: end, district: c.query.district ?? null }) };
  },
});
