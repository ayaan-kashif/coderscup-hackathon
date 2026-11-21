import { requireRole } from '@/auth/session';
import { AnalyticsPanel } from '@/components/admin/analytics';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** A7 tenant analytics */
export default async function Page() {
  const actor = await requireRole('admin');
  return (
    <StaffShell actor={actor} title="Admin — analytics" nav={ADMIN_NAV}>
      <AnalyticsPanel />
    </StaffShell>
  );
}
