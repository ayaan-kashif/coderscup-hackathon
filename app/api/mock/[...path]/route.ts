import { z } from 'zod';
import { route } from '@/lib/api/route';
import { dispatchMock } from '@/services/mocks/router';

/** SIMULATED government, payment and telecom services (PRD §21.3). Public, rate-limited, chaos-aware. */
const params = z.object({ path: z.array(z.string().max(100)).min(1).max(4) });

export const GET = route({
  operationId: 'mockGet', method: 'GET', path: '/api/mock/{path}', summary: 'Mock services (GET)', tags: ['Mock services (SIMULATED)'],
  auth: 'public', simulated: true, params, audit: false, transaction: false,
  handler: async (c, db) => {
    const out = await dispatchMock(db, 'GET', c.params.path.join('/'), Object.fromEntries(new URL(c.req.url).searchParams), undefined, c.req.signal);
    return { status: out.status, body: out.body };
  },
});

export const POST = route({
  operationId: 'mockPost', method: 'POST', path: '/api/mock/{path}', summary: 'Mock services (POST)', tags: ['Mock services (SIMULATED)'],
  auth: 'public', simulated: true, params, body: z.unknown(), audit: false, transaction: false,
  handler: async (c, db) => {
    const out = await dispatchMock(db, 'POST', c.params.path.join('/'), {}, c.body, c.req.signal);
    return { status: out.status, body: out.body };
  },
});
