import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadRuleSetRef } from '@/services/refs';
import { runTwin } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });

/** F13: run the Digital Twin for a draft — stored snapshots replayed with decide(); no notifications, payments or case changes */
export const POST = route({
  operationId: 'runTwin', method: 'POST', path: '/api/v1/rules/drafts/{id}/twin', summary: 'Run the Digital Twin for a draft', tags: ['Rules'],
  auth: 'required', params, responseStatus: 201, idempotency: 'optional',
  authorize: { action: 'rules.draft', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  audit: { action: 'twin.run', resourceType: 'twin_run' },
  handler: async (c, db) => {
    const r = await runTwin(db, c.params.id, c.actor!.tenantId!, c.actor!.id);
    const s = r.summary;
    return { status: 201, body: r, audit: { resourceId: r.id, details: { draftHash: r.draftHash, better: s.better, worse: s.worse, inFlightHarm: s.inFlightHarm } } };
  },
});
