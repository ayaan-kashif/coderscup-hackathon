import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadUserRef } from '@/services/refs';
import { revokeSessions } from '@/services/org';

const params = z.object({ id: z.string().max(64) });

/** AUTH-6: an admin revokes every session of a user in this office (tokens issued before now stop working) */
export const POST = route({
  operationId: 'revokeSessions', method: 'POST', path: '/api/v1/admin/users/{id}/revoke-sessions', summary: "Revoke a user's sessions", tags: ['Admin'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'org.manage', resource: (c, db) => loadUserRef(db, c.params.id, c.actor?.tenantId) },
  audit: { action: 'org.user.revoke_sessions', resourceType: 'user' },
  handler: async (c, db) => {
    await revokeSessions(db, c.params.id);
    return { body: { id: c.params.id, sessionsRevoked: true } };
  },
});
