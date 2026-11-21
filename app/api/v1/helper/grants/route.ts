import { z } from 'zod';
import { route, problemResult } from '@/lib/api/route';
import { duressSession, triggerDuress } from '@/services/duress';
import { unlockFamily } from '@/services/helper';

const body = z.object({ citizenId: z.uuid(), pin: z.string().regex(/^\d{4}$/), deviceId: z.string().max(64).optional() });

/** H2 / HELP-2: the family enters its OWN PIN → a scoped grant (answer, photo, submit) for 30 idle minutes or 2 hours */
export const POST = route({
  operationId: 'unlockFamily', method: 'POST', path: '/api/v1/helper/grants', summary: "Unlock a family with the family's PIN", tags: ['Helper'],
  auth: 'required', body, responseStatus: 201, idempotency: 'optional',
  authorize: { action: 'helper.work' },
  audit: { action: 'helper.unlock', resourceType: 'helper_grant' },
  handler: async (c, db) => {
    const r = await unlockFamily(db, c.actor!.id, c.body.citizenId, c.body.pin, c.body.deviceId);
    if (!r.ok) {
      const p = problemResult(c, r.locked ? 'PIN_LOCKED' : 'PIN_INVALID', r.locked ? "The family's PIN is locked for 15 minutes." : `Wrong PIN. ${r.left} tries left.`, { triesLeft: r.left });
      return { ...p, audit: { ...p.audit, subjectCitizenId: c.body.citizenId } };
    }
    if (r.duress) {
      await triggerDuress(db, { citizenId: c.body.citizenId, trigger: 'helper_unlock', helperUserId: c.actor!.id, quarantinedGrantIds: r.quarantined, session: duressSession(c, c.body.deviceId), afterCommit: c.afterCommit });
    }
    return {
      status: 201,
      body: { grantId: r.grant.id, citizenId: c.body.citizenId, scope: r.grant.scope, expiresAt: r.grant.expiresAt, idleMinutes: 30, family: r.family },
      audit: { resourceId: r.grant.id, subjectCitizenId: c.body.citizenId, details: { grantId: r.grant.id, method: 'pin' } },
    };
  },
});
