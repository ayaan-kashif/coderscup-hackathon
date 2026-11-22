import { sessionCookie } from '@/auth/tokens';
import { route } from '@/lib/api/route';
import { signInBody, signInShopkeeper } from '@/services/shop';

/**
 * Shopkeeper sign-in: username or email, and password. Any wrong detail gives the same 401 ("Username or password is wrong.").
 * 5 tries per 15 minutes per username, 20 per hour per IP; fails closed if the limiter is down.
 */
export const POST = route({
  operationId: 'shopkeeperLogin', method: 'POST', path: '/api/v1/auth/shopkeeper/login', summary: 'Shopkeeper sign-in (username or email + password)', tags: ['Shopkeeper'],
  auth: 'public', body: signInBody,
  rateLimit: ({ ip, body: b }) => [
    { name: 'shop_login_user', key: String((b as { identifier?: string })?.identifier ?? '').trim().toLowerCase().slice(0, 120), limit: 5, windowSec: 900, failClosed: true },
    { name: 'shop_login_ip', key: ip, limit: 20, windowSec: 3600, failClosed: true },
  ],
  audit: { action: 'shop.login', resourceType: 'session' },
  handler: async (c, db) => {
    const r = await signInShopkeeper(db, c.body.identifier, c.body.password);
    return { body: { token: r.token, tokenType: 'Bearer', expiresIn: 900, role: 'shopkeeper', next: '/shopkeeper' }, cookies: [sessionCookie(r.token)], audit: { resourceId: r.userId, tenantId: r.tenantId, details: {} } };
  },
});
