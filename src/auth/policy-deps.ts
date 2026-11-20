import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { helperGrants } from '@/db/schema/all';
import { rowsOf } from '@/db/rows';
import type { PolicyDeps } from './policy';

/** HELP-2: a grant ends after 2 hours or 30 idle minutes. */
export const GRANT_IDLE_MINUTES = 30;

export function dbPolicyDeps(db: DbOrTx): PolicyDeps {
  return {
    async hasLiveGrant(helperUserId, citizenId) {
      const rows = await db.select({ id: helperGrants.id }).from(helperGrants).where(and(
        eq(helperGrants.helperUserId, helperUserId),
        eq(helperGrants.citizenId, citizenId),
        isNull(helperGrants.revokedAt),
        gt(helperGrants.expiresAt, sql`now()`),
        gt(helperGrants.lastActivityAt, sql`now() - make_interval(mins => ${GRANT_IDLE_MINUTES})`),
      )).limit(1);
      return rows.length > 0;
    },
    async hasConsent(citizenId, granteeType, granteeId, need) {
      const res = await db.execute<{ ok: boolean }>(
        sql`select has_active_consent(${citizenId}::uuid, ${granteeType}, ${granteeId}::uuid, ${need.purpose}, ${need.category}) as ok`);
      return rowsOf<{ ok: boolean }>(res)[0]?.ok === true;
    },
  };
}
