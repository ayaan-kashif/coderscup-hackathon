import { and, count, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { StaffShell } from '@/components/staff/staff-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { cases } from '@/db/schema/all';

export const dynamic = 'force-dynamic';

export default async function OfficerPage() {
  const actor = await requireRole('officer');
  const t = await getTranslations('staff');
  const [open] = await getDb().select({ n: count() }).from(cases).where(and(eq(cases.tenantId, actor.tenantId!)));
  return (
    <StaffShell actor={actor} title={t('officer')}>
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
          <CardDescription>Cases in your tenant: {open?.n ?? 0}. The sorted queue with stops, rule trace and summary arrives in Phase 2 (F7).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <SimulatedBadge what="identity registry" /><SimulatedBadge what="civil registry" /><SimulatedBadge what="payment ledger" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>API</CardTitle><CardDescription>Every action here is also an API call under the same guards. See <a className="underline" href="/api/docs">/api/docs</a>.</CardDescription></CardHeader>
      </Card>
    </StaffShell>
  );
}
