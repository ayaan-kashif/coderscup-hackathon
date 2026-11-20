import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { maskCnic } from '@/auth/crypto';
import { requireRole } from '@/auth/session';
import { avatar } from '@/components/citizen/trust-pictures';
import { StaffShell } from '@/components/staff/staff-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { citizens, helperAssignments } from '@/db/schema/all';

export const dynamic = 'force-dynamic';

/** HELP-1: assigned families as avatar cards (never trust pictures), CNIC masked. Unlock with the family PIN is Phase 3. */
export default async function HelperPage() {
  const actor = await requireRole('helper');
  const t = await getTranslations('staff');
  const families = await getDb().select({ id: citizens.id, name: citizens.nameDisplay, avatarId: citizens.avatarId, last4: citizens.cnicLast4 })
    .from(helperAssignments).innerJoin(citizens, eq(citizens.id, helperAssignments.citizenId))
    .where(and(eq(helperAssignments.helperUserId, actor.id), eq(helperAssignments.status, 'active'))).limit(40);
  return (
    <StaffShell actor={actor} title={t('helper')}>
      <Card>
        <CardHeader>
          <CardTitle>My families ({families.length} / 40)</CardTitle>
          <CardDescription>Each family unlocks its own case with its PIN. Without a live unlock, every call on that family returns 403 GRANT_REQUIRED.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {families.map((f) => (
            <div key={f.id} className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center">
              <span className="text-3xl" aria-hidden>{avatar(f.avatarId)}</span>
              <span className="text-sm font-medium">{f.name}</span>
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">{maskCnic(f.last4)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </StaffShell>
  );
}
