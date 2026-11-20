import { buildOpenApi } from '@/lib/api/openapi';
import { route } from '@/lib/api/route';

export const GET = route({
  operationId: 'openapi', method: 'GET', path: '/api/docs/openapi.json', summary: 'OpenAPI 3.1 document', tags: ['Ops'],
  auth: 'public', audit: false, transaction: false,
  handler: async (c) => ({ body: buildOpenApi(new URL(c.req.url).origin) }),
});
