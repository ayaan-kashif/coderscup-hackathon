import { requireRole } from '@/auth/session';
import { RulesEditor } from '@/components/admin/rules-editor';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('admin');
  return (
    <StaffShell actor={actor} title="Admin — rules" nav={ADMIN_NAV}>
      <RulesEditor meId={actor.id} />
    </StaffShell>
  );
}
