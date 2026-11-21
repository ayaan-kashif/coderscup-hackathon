import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema/all';

export async function isSandboxTenant(tenantId: string | undefined) {
  if (!tenantId) return false;
  const [t] = await getDb().select({ s: tenants.isSandbox }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return !!t?.s;
}
