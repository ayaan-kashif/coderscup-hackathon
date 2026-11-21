import { requireRole } from '@/auth/session';
import { OfficerCaseView } from '@/components/officer/case-view';
import { OFFICER_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

/** O2: the case view. The data comes from the API, so consent and tenant are enforced on the server for every read. */
export default async function OfficerCasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRole('officer');
  const { id } = await params;
  return (
    <StaffShell actor={actor} title="Case" nav={OFFICER_NAV}>
      <OfficerCaseView caseId={id} meId={actor.id} />
    </StaffShell>
  );
}
