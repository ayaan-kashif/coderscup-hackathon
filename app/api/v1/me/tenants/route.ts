import { route } from '@/lib/api/route';
import { listMyTenants } from '@/services/auth';

/** TEN-4: the tenant switcher lists only tenants where you hold a membership */
export const GET = route({
  operationId: 'listMyTenants', method: 'GET', path: '/api/v1/me/tenants', summary: 'Tenants where I hold a role', tags: ['Auth'],
  auth: 'required', authorize: { action: 'self.read' }, audit: false,
  handler: async (c, db) => ({ body: { current: c.actor!.tenantId ?? null, items: c.actor!.role === 'citizen' ? [] : await listMyTenants(db, c.actor!.id) } }),
});
