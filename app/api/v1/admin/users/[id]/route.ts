import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadUserRef } from '@/services/refs';
import { updateUser, userPatchBody } from '@/services/org';

const params = z.object({ id: z.string().max(64) });

/** A6: change a role in this office, or deactivate / reactivate a user (sessions are revoked; the user keeps their history) */
export const PATCH = route({
  operationId: 'updateUser', method: 'PATCH', path: '/api/v1/admin/users/{id}', summary: 'Change a role, or deactivate / reactivate a user in this office', tags: ['Admin'],
  auth: 'required', params, body: userPatchBody, idempotency: 'optional',
  authorize: { action: 'org.manage', resource: (c, db) => loadUserRef(db, c.params.id, c.actor?.tenantId) },
  audit: { action: 'org.user.update', resourceType: 'user' },
  handler: async (c, db) => {
    const r = await updateUser(db, c.actor!.tenantId!, c.actor!.id, c.params.id, c.body);
    return { body: r, audit: { resourceId: c.params.id, details: { from: r.from, to: r.to } } };
  },
});
