import { z } from 'zod';
import { route } from '@/lib/api/route';
import { createDraftCase, tenantForNewCase } from '@/services/cases';

const body = z.object({
  programCode: z.string().min(2).max(20),
  channel: z.enum(['citizen', 'helper', 'api', 'officer']),
  clientSubmissionId: z.string().min(8).max(128),
  /** helpers, officers and API keys name the citizen; citizens apply for themselves */
  citizenId: z.uuid().optional(),
});

export const caseCreatedSchema = z.object({ id: z.uuid(), status: z.literal('draft'), ticks: z.number().int() });

/** PRD §21.4: create a draft case. Idempotent (API-3, OFF-4). */
export const POST = route({
  operationId: 'createCase', method: 'POST', path: '/api/v1/cases', summary: 'Create a draft case', tags: ['Cases'],
  auth: 'required', body, response: caseCreatedSchema, responseStatus: 201,
  idempotency: 'required',
  authorize: {
    action: 'case.create',
    resource: async (c) => {
      const citizenId = c.actor?.role === 'citizen' ? (c.actor.citizenId ?? null) : (c.body.citizenId ?? null);
      return { citizenId, tenantId: c.actor?.tenantId ?? null };
    },
  },
  audit: { action: 'case.create', resourceType: 'case' },
  handler: async (c, db) => {
    const actor = c.actor!;
    const citizenId = actor.role === 'citizen' ? actor.citizenId ?? null : c.body.citizenId ?? null;
    if (actor.role === 'citizen' && !citizenId) return { status: 422, body: { code: 'VALIDATION_FAILED', detail: 'Finish setting up your profile first.' } };
    const tenantId = await tenantForNewCase(db, actor, citizenId);
    const { row, created } = await createDraftCase(db, {
      actor, tenantId, citizenId, programCode: c.body.programCode, clientSubmissionId: c.body.clientSubmissionId,
      channel: actor.kind === 'api_key' ? 'api' : actor.role === 'helper' ? 'helper' : actor.role === 'officer' ? 'officer' : 'citizen',
    });
    return {
      status: created ? 201 : 200,
      // ticks: 2 = two grey ticks, "reached the office" (OFF-5)
      body: { id: row.id, status: 'draft', ticks: 2 },
      audit: { resourceId: row.id, tenantId, subjectCitizenId: citizenId, details: { created, clientSubmissionId: c.body.clientSubmissionId } },
    };
  },
});
