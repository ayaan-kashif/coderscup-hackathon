import { modelIdsSchema } from '@/ai/model-ids';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { chaosSettings, MOCK_SERVICES, systemConfig } from '@/db/schema/all';
import { costsSchema } from '@/domain/rules/schema';

/** ADM-3: the keys an admin may set, each with its own schema (config is validated as strictly as code). */
export const CONFIG_SCHEMAS = {
  'decision.costs': costsSchema.extend({ note: z.string().max(200).optional() }),
  'decision.floor': z.number().min(0.5).max(0.999),
  'payments.autoCap': z.number().int().positive().max(1_000_000),
  'cooling_off.approval_minutes': z.number().int().min(0).max(60 * 72),
  'cooling_off.payout_change_minutes': z.number().int().min(0).max(60 * 96),
  'models.ids': modelIdsSchema,
  'pipeline.inline_fallback': z.boolean(),
} as const;
export type ConfigKey = keyof typeof CONFIG_SCHEMAS;
export const CONFIG_KEYS = Object.keys(CONFIG_SCHEMAS) as [ConfigKey, ...ConfigKey[]];

/** Effective config for a tenant: tenant overrides on top of global defaults. */
export async function effectiveConfig(db: DbOrTx, tenantId: string | null) {
  const rows = await db.select().from(systemConfig).where(tenantId ? or(isNull(systemConfig.tenantId), eq(systemConfig.tenantId, tenantId)) : isNull(systemConfig.tenantId));
  const out: Record<string, { value: unknown; scope: 'global' | 'tenant'; updatedAt: Date }> = {};
  for (const r of rows.sort((a, b) => (a.tenantId ? 1 : 0) - (b.tenantId ? 1 : 0))) {
    out[r.key] = { value: r.value, scope: r.tenantId ? 'tenant' : 'global', updatedAt: r.updatedAt };
  }
  return out;
}

export async function setTenantConfig(db: DbOrTx, tenantId: string, key: ConfigKey, value: unknown, userId: string) {
  const [prev] = await db.select().from(systemConfig).where(and(eq(systemConfig.key, key), eq(systemConfig.tenantId, tenantId))).limit(1);
  await db.insert(systemConfig).values({ key, tenantId, value: value as object, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [systemConfig.key, systemConfig.tenantId], set: { value: value as object, updatedBy: userId, updatedAt: new Date() } });
  return prev?.value ?? null;
}

export const chaosBody = z.object({
  service: z.enum(MOCK_SERVICES),
  latencyMs: z.number().int().min(0).max(30_000),
  timeoutRate: z.number().min(0).max(1),
  errorRate: z.number().min(0).max(1),
});

export async function listChaos(db: DbOrTx) {
  return db.select().from(chaosSettings).orderBy(chaosSettings.service);
}

export async function setChaos(db: DbOrTx, c: z.infer<typeof chaosBody>, userId: string) {
  const [prev] = await db.select().from(chaosSettings).where(eq(chaosSettings.service, c.service)).limit(1);
  await db.insert(chaosSettings).values({ ...c, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: chaosSettings.service, set: { latencyMs: c.latencyMs, timeoutRate: c.timeoutRate, errorRate: c.errorRate, updatedBy: userId, updatedAt: new Date() } });
  return prev ? { latencyMs: prev.latencyMs, timeoutRate: prev.timeoutRate, errorRate: prev.errorRate } : null;
}
