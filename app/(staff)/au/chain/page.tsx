import { requireRole } from '@/auth/session';
import { AuditPanel } from '@/components/staff/audit-panel';
import { AUDITOR_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** AU2: chain status, verify now, the first broken row */
export default async function ChainPage() {
  const actor = await requireRole('auditor');
  return (
    <StaffShell actor={actor} title="Auditor — chain integrity" nav={AUDITOR_NAV}>
      <AuditPanel />
    </StaffShell>
  );
}
