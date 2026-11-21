import { route } from '@/lib/api/route';
import { createUser, listUsers, newUserBody } from '@/services/org';

/** A6 / ADM-1: users and roles in this office */
export const GET = route({
  operationId: 'listUsers', method: 'GET', path: '/api/v1/admin/users', summary: 'Users and roles in this office', tags: ['Admin'],
  auth: 'required',
  authorize: { action: 'org.manage' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listUsers(db, c.actor!.tenantId!) } }),
});

/** create a staff user (fictional .test address) with a one-time temporary password */
export const POST = route({
  operationId: 'createUser', method: 'POST', path: '/api/v1/admin/users', summary: 'Add a staff user to this office', tags: ['Admin'],
  auth: 'required', body: newUserBody, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'org.manage' },
  audit: { action: 'org.user.create', resourceType: 'user' },
  handler: async (c, db) => {
    const r = await createUser(db, c.actor!.tenantId!, c.body);
    return { status: 201, body: { id: r.id, temporaryPassword: r.temporaryPassword, note: 'Shown once. The user should change it.' }, audit: { resourceId: r.id, details: { role: c.body.role, isSenior: c.body.isSenior } } };
  },
});
