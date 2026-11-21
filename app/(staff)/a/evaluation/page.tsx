import { requireRole } from '@/auth/session';
import { CostSlider, EvalDashboard } from '@/components/admin/evaluation';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('admin');
  return (
    <StaffShell actor={actor} title="Admin — cost and evaluation" nav={ADMIN_NAV}>
      <CostSlider />
      <EvalDashboard />
    </StaffShell>
  );
}
