import { desc, eq } from 'drizzle-orm';
import { districts, scamAlerts } from '@/db/schema/all';
import { route } from '@/lib/api/route';

/** SCAM-6: drafted district alerts waiting for an officer */
export const GET = route({
  operationId: 'listScamAlerts', method: 'GET', path: '/api/v1/scam/alerts', summary: 'District scam alerts (draft and sent)', tags: ['Scams'],
  auth: 'required',
  authorize: { action: 'scam.desk' },
  audit: false,
  handler: async (c, db) => {
    const rows = await db.select({ a: scamAlerts, district: districts.code, districtName: districts.name }).from(scamAlerts).innerJoin(districts, eq(districts.id, scamAlerts.districtId))
      .where(eq(scamAlerts.tenantId, c.actor!.tenantId!)).orderBy(desc(scamAlerts.createdAt)).limit(50);
    return { body: { items: rows.map((r) => ({ ...r.a, district: r.district, districtName: r.districtName })) } };
  },
});
