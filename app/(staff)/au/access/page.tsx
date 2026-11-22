import { requireRole } from '@/auth/session';
import { AllReads, ConsentAccess } from '@/components/auditor/auditor';
import { AUDITOR_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** AU3: consent records and every read, allowed and refused; break-glass */
export default async function AccessPage() {
  const actor = await requireRole('auditor');
  return (
    <StaffShell actor={actor} title="Auditor — consent and access" nav={AUDITOR_NAV}>
      <AllReads />
      <ConsentAccess />
    </StaffShell>
  );
}
