import { and, desc, eq, isNull } from 'drizzle-orm';
import { districts, scamReports } from '@/db/schema/all';
import { route } from '@/lib/api/route';

/** O4 scam desk: "not sure" messages waiting for an officer's label, with claims, checks and Jev probabilities */
export const GET = route({
  operationId: 'getScamDesk', method: 'GET', path: '/api/v1/scam/desk', summary: 'Not-sure messages for the scam desk', tags: ['Scams'],
  auth: 'required',
  authorize: { action: 'scam.desk' },
  audit: false,
  handler: async (c, db) => {
    const rows = await db.select({ r: scamReports, district: districts.code }).from(scamReports).leftJoin(districts, eq(districts.id, scamReports.districtId))
      .where(and(eq(scamReports.tenantId, c.actor!.tenantId!), eq(scamReports.verdict, 'not_sure'), isNull(scamReports.officerLabel))).orderBy(desc(scamReports.createdAt)).limit(50);
    return { body: { items: rows.map(({ r, district }) => ({ id: r.id, district, channel: r.channel, text: r.messageText, claims: r.extractedClaims, ledgerCheck: r.ledgerCheck, probabilities: r.probabilities, createdAt: r.createdAt })) } };
  },
});
