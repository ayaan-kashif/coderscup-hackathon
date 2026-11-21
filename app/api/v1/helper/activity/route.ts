import { route } from '@/lib/api/route';
import { helperActivity } from '@/services/helper';

/** H4: the helper's own actions with family, time and unlock id (read only) */
export const GET = route({
  operationId: 'getHelperActivity', method: 'GET', path: '/api/v1/helper/activity', summary: 'My actions as a helper', tags: ['Helper'],
  auth: 'required',
  authorize: { action: 'helper.work' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await helperActivity(db, c.actor!.id) } }),
});
