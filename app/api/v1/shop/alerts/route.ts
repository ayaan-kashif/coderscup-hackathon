import { route } from '@/lib/api/route';
import { listMyDistrictAlerts } from '@/services/shop';

/** Alerts in my district: only the alerts an officer approved, for the shopkeeper's own district, newest first. Never a draft. */
export const GET = route({
  operationId: 'shopAlerts', method: 'GET', path: '/api/v1/shop/alerts', summary: 'Approved scam alerts in my district', tags: ['Shopkeeper'],
  auth: 'required', shopkeeper: true, authorize: { action: 'shop.alerts.read' }, audit: false, transaction: false,
  handler: async (c, db) => ({ body: await listMyDistrictAlerts(db, c.actor!.id) }),
});
