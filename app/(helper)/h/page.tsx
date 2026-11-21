import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { HelperApp } from '@/components/helper/helper-app';
import { StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** Helper Mode (/h): H1–H4. Every family action is checked on the server against a live unlock (HELP-2). */
export default async function HelperPage() {
  const actor = await requireRole('helper');
  const t = await getTranslations('staff');
  return (
    <StaffShell actor={actor} title={t('helper')}>
      <HelperApp />
    </StaffShell>
  );
}
