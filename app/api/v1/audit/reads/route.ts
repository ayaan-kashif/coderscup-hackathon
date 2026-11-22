import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { dataReads, readsQuery, toCsv } from '@/services/org';

const COLS = ['seq', 'ts', 'actorType', 'actorId', 'action', 'resourceType', 'resourceId', 'citizenId', 'outcome', 'code'];

/** AU3: every read of personal data in this office, allowed and denied, read-only, with JSON or CSV export */
export const GET = route({
  operationId: 'listDataReads', method: 'GET', path: '/api/v1/audit/reads', summary: 'Every data read, allowed and denied (export as CSV)', tags: ['Audit'],
  auth: 'required', query: readsQuery,
  authorize: { action: 'audit.read' },
  audit: { action: 'audit.reads.read', resourceType: 'audit_chain' },
  handler: async (c, db) => {
    if (c.verdict?.view !== 'all') throw new ApiError('FORBIDDEN_ROLE', 'The full read log is for auditors.');
    const r = await dataReads(db, c.actor!.tenantId!, c.query);
    const audit = { details: { format: c.query.format, shown: r.shown, outcome: c.query.outcome ?? 'any' } };
    if (c.query.format === 'csv') {
      return { body: null, raw: { body: toCsv(r.items, COLS), contentType: 'text/csv; charset=utf-8' }, headers: { 'Content-Disposition': `attachment; filename="amanat-data-reads-${new Date().toISOString().slice(0, 10)}.csv"` }, audit };
    }
    return { body: r, audit };
  },
});
