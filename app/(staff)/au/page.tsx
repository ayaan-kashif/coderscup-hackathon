import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { AuditPanel } from '@/components/staff/audit-panel';
import { StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function AuditorPage() {
  const actor = await requireRole('auditor');
  const t = await getTranslations('staff');
  return (
    <StaffShell actor={actor} title={t('auditor')}>
      <AuditPanel />
    </StaffShell>
  );
}
