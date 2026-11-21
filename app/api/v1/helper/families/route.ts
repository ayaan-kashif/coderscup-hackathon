import { route } from '@/lib/api/route';
import { helperFamilies } from '@/services/helper';

/** H1 / HELP-1: up to 40 assigned families as avatar cards (never trust pictures; CNIC masked) */
export const GET = route({
  operationId: 'listHelperFamilies', method: 'GET', path: '/api/v1/helper/families', summary: 'My assigned families', tags: ['Helper'],
  auth: 'required',
  authorize: { action: 'helper.work' },
  audit: false,
  handler: async (c, db) => ({ body: await helperFamilies(db, c.actor!.id) }),
});
