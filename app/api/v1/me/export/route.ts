import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { exportCitizenData } from '@/services/data-export';

/** CONS-8: download everything held about me as JSON (her own record only; PIN-verified session) */
export const GET = route({
  operationId: 'exportMyData', method: 'GET', path: '/api/v1/me/export', summary: 'Download my data as JSON', tags: ['Consent'],
  auth: 'required',
  authorize: { action: 'accesslog.read', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  rateLimit: ({ actor }) => [{ name: 'export', key: actor?.id ?? 'anon', limit: 5, windowSec: 600 }],
  audit: { action: 'consent.export', resourceType: 'citizen' },
  handler: async (c, db) => {
    const data = await exportCitizenData(db, c.actor!.citizenId!);
    if (!data) throw new ApiError('NOT_FOUND');
    return {
      body: data,
      headers: { 'Content-Disposition': `attachment; filename="amanat-my-data-${new Date().toISOString().slice(0, 10)}.json"` },
      audit: { resourceId: c.actor!.citizenId!, subjectCitizenId: c.actor!.citizenId!, details: { cases: data.cases.length } },
    };
  },
});
