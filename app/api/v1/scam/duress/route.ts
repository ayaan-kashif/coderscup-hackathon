import { route } from '@/lib/api/route';
import { listDuressAlarms } from '@/services/duress';

/** Silent Duress PIN: CRITICAL DURESS_SILENT_ALARM items for the Scam Desk (officer-only; never shown to citizen or helper) */
export const GET = route({
  operationId: 'listDuressAlarms', method: 'GET', path: '/api/v1/scam/duress', summary: 'Silent duress alarms for this office', tags: ['Scams'],
  auth: 'required',
  authorize: { action: 'scam.desk' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listDuressAlarms(db, c.actor!.tenantId!) } }),
});
