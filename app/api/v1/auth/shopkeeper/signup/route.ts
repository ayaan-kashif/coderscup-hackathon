import { sessionCookie } from '@/auth/tokens';
import { route } from '@/lib/api/route';
import { signUpBody, signUpShopkeeper } from '@/services/shop';

/**
 * A shopkeeper signs up with a username and a password (fictional details only; an email is optional and must end in .test, and nothing
 * is ever emailed). The user, password hash (argon2id), shop profile and membership are created in this one transaction, and a session opens.
 * 3 sign-ups per hour per IP; fails closed if the limiter is down.
 */
export const POST = route({
  operationId: 'shopkeeperSignup', method: 'POST', path: '/api/v1/auth/shopkeeper/signup', summary: 'Shopkeeper sign-up (username + password)', tags: ['Shopkeeper'],
  auth: 'public', body: signUpBody, responseStatus: 201,
  rateLimit: ({ ip }) => [{ name: 'shop_signup_ip', key: ip, limit: 3, windowSec: 3600, failClosed: true }],
  audit: { action: 'shop.signup', resourceType: 'user' },
  handler: async (c, db) => {
    const r = await signUpShopkeeper(db, c.body);
    return {
      status: 201,
      body: { token: r.token, tokenType: 'Bearer', expiresIn: 900, user: { id: r.userId, role: 'shopkeeper', username: r.username, shopName: r.shopName, district: r.district }, next: '/shopkeeper' },
      cookies: [sessionCookie(r.token)],
      // ids and the district only: no name, no username in the audit log
      audit: { resourceId: r.userId, tenantId: r.tenantId, details: { districtCode: r.district.code } },
    };
  },
});
