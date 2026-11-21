import { requireRole } from '@/auth/session';
import { PayoutDesk } from '@/components/officer/desks';
import { OFFICER_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('officer');
  return (
    <StaffShell actor={actor} title="Payout changes" nav={OFFICER_NAV}>
      <PayoutDesk />
    </StaffShell>
  );
}
