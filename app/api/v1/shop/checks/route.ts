import { route } from '@/lib/api/route';
import { listMyChecks } from '@/services/shop';

/** My checks: the shopkeeper's own message checks (date, verdict, reasons). Nobody else's. */
export const GET = route({
  operationId: 'shopChecks', method: 'GET', path: '/api/v1/shop/checks', summary: 'My message checks', tags: ['Shopkeeper'],
  auth: 'required', shopkeeper: true, authorize: { action: 'shop.checks.read' }, audit: false, transaction: false,
  handler: async (c, db) => ({ body: { items: await listMyChecks(db, c.actor!.id) } }),
});
