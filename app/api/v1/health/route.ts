import { route } from '@/lib/api/route';

/** Liveness only: no database, no dependencies. */
export const GET = route({
  operationId: 'health', method: 'GET', path: '/api/v1/health', summary: 'Liveness', tags: ['Ops'],
  auth: 'public', audit: false, transaction: false,
  handler: async () => ({ body: { status: 'ok', service: 'amanat-ai', prototype: true, time: new Date().toISOString(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' } }),
});
