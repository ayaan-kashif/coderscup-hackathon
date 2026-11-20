import { z } from 'zod';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { CONFIG_KEYS, CONFIG_SCHEMAS, effectiveConfig, setTenantConfig } from '@/services/config';
import { costThreshold } from '@/domain/threshold';

/** ADM-3: live settings. Admin reads and writes for their tenant; auditor reads. */
export const GET = route({
  operationId: 'getConfig', method: 'GET', path: '/api/v1/admin/config', summary: 'Effective configuration for your tenant', tags: ['Admin'],
  auth: 'required', authorize: { action: 'config.read' }, audit: false, transaction: false,
  handler: async (c, db) => ({ body: { tenantId: c.actor!.tenantId, config: await effectiveConfig(db, c.actor!.tenantId!) } }),
});

const body = z.object({ key: z.enum(CONFIG_KEYS), value: z.unknown() });

export const PUT = route({
  operationId: 'setConfig', method: 'PUT', path: '/api/v1/admin/config', summary: 'Change one setting for your tenant (no redeploy)', tags: ['Admin'],
  auth: 'required', body, idempotency: 'optional',
  authorize: { action: 'config.write' },
  audit: { action: 'config.update', resourceType: 'system_config' },
  handler: async (c, db) => {
    const parsed = CONFIG_SCHEMAS[c.body.key].safeParse(c.body.value);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', `Invalid value for ${c.body.key}.`, { extra: { errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    const previous = await setTenantConfig(db, c.actor!.tenantId!, c.body.key, parsed.data, c.actor!.id);
    const config = await effectiveConfig(db, c.actor!.tenantId!);
    const costs = config['decision.costs']?.value as { wrongApproval: number; review: number; delay: number } | undefined;
    const floor = (config['decision.floor']?.value as number | undefined) ?? 0.9;
    return {
      body: { key: c.body.key, value: parsed.data, previous, threshold: costs ? costThreshold(costs, floor) : null },
      audit: { resourceId: c.body.key, details: { key: c.body.key } },
    };
  },
});
