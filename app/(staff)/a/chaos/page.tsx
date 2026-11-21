import { requireRole } from '@/auth/session';
import { ConfigPanel } from '@/components/admin/breakit-org';
import { ChaosPanel } from '@/components/staff/chaos-panel';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('admin');
  return (
    <StaffShell actor={actor} title="Admin — chaos and config" nav={ADMIN_NAV}>
      <ChaosPanel />
      <ConfigPanel />
    </StaffShell>
  );
}
