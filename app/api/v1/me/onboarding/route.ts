import { route } from '@/lib/api/route';
import { onboardingState } from '@/services/account';

/** Where her first-run set-up stands: trust picture, consent, then "About you" (name, date of birth, district). Only her own record. */
export const GET = route({
  operationId: 'myOnboarding', method: 'GET', path: '/api/v1/me/onboarding', summary: 'My first-run progress', tags: ['Auth'],
  auth: 'required', audit: false, transaction: false,
  authorize: { action: 'self.update' },
  handler: async (c, db) => {
    if (c.actor?.role !== 'citizen' || !c.actor.citizenId) return { status: 403, body: { code: 'FORBIDDEN_ROLE', detail: 'Only a citizen has this.' } };
    return { body: await onboardingState(db, c.actor.citizenId) };
  },
});
