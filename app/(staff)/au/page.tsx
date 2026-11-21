import { requireRole } from '@/auth/session';
import { DecisionSearch } from '@/components/auditor/auditor';
import { AUDITOR_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** AU1: read-only decision search, trace and replay */
export default async function AuditorPage() {
  const actor = await requireRole('auditor');
  return (
    <StaffShell actor={actor} title="Auditor — decisions" nav={AUDITOR_NAV}>
      <DecisionSearch />
    </StaffShell>
  );
}
