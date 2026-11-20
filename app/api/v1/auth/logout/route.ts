import { SESSION_COOKIE } from '@/auth/tokens';
import { route } from '@/lib/api/route';

export const POST = route({
  operationId: 'logout', method: 'POST', path: '/api/v1/auth/logout', summary: 'Clear the session cookie', tags: ['Auth'],
  auth: 'optional', citizenStage: 'otp', audit: false, transaction: false,
  handler: async () => ({ body: { ok: true }, cookies: [{ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' }] }),
});
