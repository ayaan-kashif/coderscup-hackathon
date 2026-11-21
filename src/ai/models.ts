import type { DbOrTx } from '@/db/client';
import { effectiveConfig } from '@/services/config';

export { DEFAULT_MODEL_IDS, modelIdsSchema, type ModelIds } from './model-ids';
import { DEFAULT_MODEL_IDS, modelIdsSchema, type ModelIds } from './model-ids';

export async function getModelIds(db: DbOrTx, tenantId: string | null): Promise<ModelIds> {
  const cfg = await effectiveConfig(db, tenantId);
  const parsed = modelIdsSchema.partial().safeParse(cfg['models.ids']?.value ?? {});
  return { ...DEFAULT_MODEL_IDS, ...(parsed.success ? parsed.data : {}) };
}

/** Rough list prices (USD per 1M tokens) used only to estimate cost_usd in ai_calls; labelled estimates. */
const PRICE: Record<string, [number, number]> = {
  'google/gemini-3.8-flash': [0.3, 2.5],
  'google/gemini-3.5-flash-lite': [0.1, 0.4],
  'typesafe-ai/jev': [0.05, 0],
  'google/gemini-embedding-001': [0.15, 0],
};
export function estimateCostUsd(model: string, inTok?: number, outTok?: number) {
  const p = PRICE[model];
  if (!p) return null;
  return ((inTok ?? 0) * p[0] + (outTok ?? 0) * p[1]) / 1e6;
}
