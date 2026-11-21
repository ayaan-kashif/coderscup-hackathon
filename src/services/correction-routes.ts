import { z } from 'zod';
import { getDb } from '@/db/client';
import { dispatchCaseProcess } from '@/jobs/inngest';
import type { RouteDef } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { correctionDecisionBody, decideCorrection } from './complaints';
import { notifyCitizen } from './notify';
import { loadCorrectionRef } from './refs';

const params = z.object({ id: z.string().max(64) });

/** the approve and reject routes share everything but the verdict */
export function correctionDecisionSpec(approve: boolean): RouteDef<z.infer<typeof correctionDecisionBody>, undefined, z.infer<typeof params>> {
  const verb = approve ? 'approve' : 'reject';
  return {
    operationId: `${verb}Correction`, method: 'POST', path: `/api/v1/corrections/{id}/${verb}`, summary: `${approve ? 'Approve' : 'Reject'} a correction request`, tags: ['Complaints'],
    auth: 'required', params, body: correctionDecisionBody, idempotency: 'optional',
    authorize: { action: 'correction.review', resource: (c, db) => loadCorrectionRef(db, c.params.id) },
    audit: { action: `correction.${verb}`, resourceType: 'correction_request' },
    handler: async (c, db) => {
      const r = await decideCorrection(db, c.params.id, c.actor!.id, approve, c.body);
      c.afterCommit(async () => {
        await notifyCitizen(getDb(), { tenantId: r.request.tenantId, citizenId: r.request.citizenId, key: 'correction_done', vars: { outcome: approve ? 'approved' : 'not approved', outcome_ur: approve ? 'منظور ہو گئی' : 'منظور نہیں ہوئی' } });
        if (r.redecide && r.request.caseId) await dispatchCaseProcess(r.request.caseId, defer);
      });
      return { body: { id: c.params.id, status: approve ? 'approved' : 'rejected', redecide: r.redecide }, audit: { details: { field: r.request.fieldKey, reasonCode: c.body.reasonCode, caseId: r.request.caseId } } };
    },
  };
}
