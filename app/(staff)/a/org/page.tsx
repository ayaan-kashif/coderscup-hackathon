import { requireRole } from '@/auth/session';
import { OrgPanel } from '@/components/admin/breakit-org';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('admin');
  return (
    <StaffShell actor={actor} title="Admin — organisation" nav={ADMIN_NAV}>
      <OrgPanel />
    </StaffShell>
  );
}
