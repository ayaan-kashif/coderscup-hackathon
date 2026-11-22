import { z } from 'zod';
import { SESSION_COOKIE } from '@/auth/tokens';
import { route } from '@/lib/api/route';
import { deleteMyShopAccount, shopProfileFor } from '@/services/shop';

/** Who am I: the shopkeeper's own shop and district (nothing else) */
export const GET = route({
  operationId: 'shopMe', method: 'GET', path: '/api/v1/shop/me', summary: 'My shop', tags: ['Shopkeeper'],
  auth: 'required', shopkeeper: true, authorize: { action: 'shop.self' }, audit: false, transaction: false,
  handler: async (c, db) => {
    const me = await shopProfileFor(db, c.actor!.id);
    return { body: { role: 'shopkeeper', username: me.username, shopName: me.shopName, email: me.email, district: { code: me.district.code, name: me.district.name, nameUr: me.district.nameUr } } };
  },
});

const deleteBody = z.object({ password: z.string().min(1).max(200), confirm: z.literal(true) });

/** "Delete my shop account": needs his password and an explicit confirmation; removes the profile, membership, login and sessions, and unlinks his checks */
export const DELETE = route({
  operationId: 'shopDelete', method: 'DELETE', path: '/api/v1/shop/me', summary: 'Delete my shop account (password + confirmation)', tags: ['Shopkeeper'],
  auth: 'required', shopkeeper: true, body: deleteBody, authorize: { action: 'shop.self' },
  rateLimit: ({ actor }) => [{ name: 'shop_delete_actor', key: actor?.id ?? 'anon', limit: 5, windowSec: 900, failClosed: true }],
  audit: { action: 'shop.delete', resourceType: 'user' },
  handler: async (c, db) => {
    const id = c.actor!.id;
    await deleteMyShopAccount(db, id, c.body.password);
    return { body: { deleted: true }, cookies: [{ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' }], audit: { resourceId: id, tenantId: c.actor!.tenantId, details: {} } };
  },
});
