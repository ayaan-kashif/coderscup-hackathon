import { route } from '@/lib/api/route';
import { getSystemStatus } from '@/services/status';

/** OBS-2: each dependency's health and the audit chain status. Public; no personal data. */
export const GET = route({
  operationId: 'status', method: 'GET', path: '/api/v1/status', summary: 'Dependency and audit-chain status', tags: ['Ops'],
  auth: 'public', audit: false, transaction: false,
  handler: async (_c, db) => {
    const s = await getSystemStatus(db);
    return { status: s.overall === 'down' ? 503 : 200, body: s };
  },
});
