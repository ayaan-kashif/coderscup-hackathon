import { route } from '@/lib/api/route';
import { planFor, usage } from '@/services/plans';

/** ADM-4: this office's plan, its limits and today's / this month's usage (limits are set by the platform, not the office) */
export const GET = route({
  operationId: 'getPlanUsage', method: 'GET', path: '/api/v1/admin/plan', summary: 'Plan limits and usage for this office', tags: ['Admin'],
  auth: 'required', authorize: { action: 'org.manage' }, audit: false,
  handler: async (c, db) => {
    const tid = c.actor!.tenantId!;
    const [plan, u] = await Promise.all([planFor(db, tid), usage(db, tid)]);
    return { body: { plan: { code: plan.code, name: plan.name }, limits: plan.limits, usage: u } };
  },
});
