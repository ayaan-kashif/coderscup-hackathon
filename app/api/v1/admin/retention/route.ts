import { route } from '@/lib/api/route';
import { RETENTION, retentionSweep } from '@/services/jobs';

/** §22.2: retention policy and a manual run of the daily sweep (each deletion is audited by the sweep itself) */
export const GET = route({
  operationId: 'getRetentionPolicy', method: 'GET', path: '/api/v1/admin/retention', summary: 'Retention periods', tags: ['Admin'],
  auth: 'required', authorize: { action: 'org.manage' }, audit: false,
  handler: async () => ({ body: { policy: RETENTION, schedule: 'daily 02:00 PKT' } }),
});

export const POST = route({
  operationId: 'runRetentionSweep', method: 'POST', path: '/api/v1/admin/retention', summary: 'Run the retention sweep now', tags: ['Admin'],
  auth: 'required', idempotency: 'none', authorize: { action: 'org.manage' },
  audit: { action: 'retention.run', resourceType: 'system' },
  handler: async (_c, db) => {
    const summary = await retentionSweep(db);
    return { body: { summary }, audit: { details: summary } };
  },
});
