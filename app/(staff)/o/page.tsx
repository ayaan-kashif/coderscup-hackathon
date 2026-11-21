import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { OfficerQueue } from '@/components/officer/queue';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { OFFICER_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** O1: the priority queue. Every action is also an API call under the same guards (/api/docs). */
export default async function OfficerPage() {
  const actor = await requireRole('officer');
  const t = await getTranslations('staff');
  return (
    <StaffShell actor={actor} title={t('officer')} nav={OFFICER_NAV}>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">Review queue</h1><SimulatedBadge what="registries" /><SimulatedBadge what="payment ledger" /></div>
      <OfficerQueue />
    </StaffShell>
  );
}
