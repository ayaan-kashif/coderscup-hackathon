import 'server-only';
import { cookies } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { Actor, Role } from './actor';
import { authenticate } from './authenticate';

/** The actor behind the session cookie, for server components. Same verification as the API. */
export async function getPageActor(): Promise<Actor | null> {
  const store = await cookies();
  const cookie = store.getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
  try {
    const { actor } = await authenticate({ headers: new Headers({ cookie }) }, getDb());
    return actor;
  } catch (e) {
    const first = (m: string) => m.split('\n')[0];
    console.error(JSON.stringify({ level: 'warn', msg: 'page session rejected', error: e instanceof Error ? first(e.message) : String(e), cause: e instanceof Error && e.cause instanceof Error ? e.cause.message : undefined }));
    return null;
  }
}

/** Server-side page guard: the UI mirrors the API policy, it never replaces it. */
export async function requireRole(...roles: Role[]): Promise<Actor> {
  const actor = await getPageActor();
  // a signed-in shopkeeper has no business on any other portal: a real 403, not a bounce to the login page
  if (actor?.role === 'shopkeeper' && !roles.includes('shopkeeper')) forbidden();
  if ((!actor || !actor.role || !roles.includes(actor.role)) && roles[0] === 'shopkeeper') redirect('/login/shopkeeper');
  if (!actor || !actor.role || !roles.includes(actor.role)) redirect(`/login?next=${encodeURIComponent(roles[0] === 'citizen' ? '/c' : `/${{ officer: 'o', admin: 'a', auditor: 'au', helper: 'h', shopkeeper: 'shopkeeper' }[roles[0] as Exclude<Role, 'citizen'>]}`)}`);
  return actor;
}

export const HOME_FOR_ROLE: Record<Role, string> = { citizen: '/c', helper: '/h', officer: '/o', admin: '/a', auditor: '/au', shopkeeper: '/shopkeeper' };
