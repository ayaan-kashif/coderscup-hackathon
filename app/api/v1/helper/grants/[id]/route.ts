import { z } from 'zod';
import { route } from '@/lib/api/route';
import { lockGrant } from '@/services/helper';

const params = z.object({ id: z.uuid() });

/** HELP-3: lock the family (also happens automatically when switching families or after idle/expiry) */
export const DELETE = route({
  operationId: 'lockFamily', method: 'DELETE', path: '/api/v1/helper/grants/{id}', summary: 'Lock the unlocked family', tags: ['Helper'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'helper.work' },
  audit: { action: 'helper.lock', resourceType: 'helper_grant' },
  handler: async (c, db) => {
    const r = await lockGrant(db, c.actor!.id, c.params.id);
    return { body: { grantId: r.id, locked: true }, audit: { resourceId: r.id, subjectCitizenId: r.citizenId } };
  },
});
