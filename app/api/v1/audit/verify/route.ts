import { z } from 'zod';
import { chainIdFor, verifyChain } from '@/lib/audit';
import { route } from '@/lib/api/route';

const body = z.object({ scope: z.enum(['tenant', 'global']).default('tenant') });

/** AUD-2: runs audit_verify() and returns the first broken row, if any. Admins and auditors. */
export const POST = route({
  operationId: 'auditVerify', method: 'POST', path: '/api/v1/audit/verify', summary: 'Verify the audit hash chain', tags: ['Audit'],
  auth: 'required', body, idempotency: 'none',
  authorize: { action: 'audit.verify' },
  audit: { action: 'audit.verify', resourceType: 'audit_chain' },
  handler: async (c, db) => {
    const chainId = c.body.scope === 'global' ? 'global' : chainIdFor(c.actor!.tenantId);
    const v = await verifyChain(db, chainId);
    return {
      body: { ...v, checkedAt: new Date().toISOString(), meaning: v.intact ? 'intact' : v.missingTail ? 'rows deleted from the end of the chain' : `first broken row id ${v.brokenAt}` },
      audit: { resourceId: chainId, details: { intact: v.intact, length: v.length, brokenAt: v.brokenAt, missingTail: v.missingTail } },
    };
  },
});
