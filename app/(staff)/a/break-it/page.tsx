import { requireRole } from '@/auth/session';
import { BreakIt } from '@/components/admin/breakit-org';
import { isSandboxTenant } from '@/services/tenancy';
import { ADMIN_NAV, StaffShell } from '@/components/staff/staff-shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requireRole('admin');
  const sandbox = await isSandboxTenant(actor.tenantId);
  return (
    <StaffShell actor={actor} title="Admin — Break It" nav={ADMIN_NAV}>
      <BreakIt sandbox={sandbox} />
    </StaffShell>
  );
}
