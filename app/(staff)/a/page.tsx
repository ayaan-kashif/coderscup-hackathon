import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { ChaosPanel } from '@/components/staff/chaos-panel';
import { CostPanel } from '@/components/staff/cost-panel';
import { StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const actor = await requireRole('admin');
  const t = await getTranslations('staff');
  return (
    <StaffShell actor={actor} title={t('admin')}>
      <CostPanel />
      <ChaosPanel />
    </StaffShell>
  );
}
