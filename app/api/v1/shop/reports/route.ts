import { z } from 'zod';
import { route } from '@/lib/api/route';
import { reportMyFake } from '@/services/shop';

const body = z.object({ reportId: z.uuid() });

/** Report this scam: his own confirmed fake now counts for his district on the Scam Map (and can draft a district alert for an officer to approve) */
export const POST = route({
  operationId: 'shopReport', method: 'POST', path: '/api/v1/shop/reports', summary: 'Report a scam I checked', tags: ['Shopkeeper'],
  auth: 'required', shopkeeper: true, body, authorize: { action: 'scam.report' },
  audit: { action: 'shop.report', resourceType: 'scam_report' },
  handler: async (c, db) => {
    const r = await reportMyFake(db, c.actor!.id, c.body.reportId);
    return { body: r, audit: { resourceId: c.body.reportId, tenantId: c.actor!.tenantId, details: { alreadyReported: r.already, alertDrafted: !!r.alertDrafted } } };
  },
});
