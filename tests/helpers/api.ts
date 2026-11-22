import { seedCore } from '@/services/seed/core';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { resetBreakers, setTransport } from '@/services/adapters';
import { createTestDb, type TestDb } from './pglite';

export const TEST_PASSWORD = 'test-only-password-123';
export const TEST_PIN = '2580';
export const TEST_SHOP_PASSWORD = 'shop-test-password-1';

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string | string[]>> }) => Promise<Response>;

export type ApiCall = { method?: string; token?: string; apiKey?: string; body?: unknown; headers?: Record<string, string>; params?: Record<string, string | string[]>; query?: Record<string, string>; ip?: string };

export async function call(handler: Handler, path: string, o: ApiCall = {}) {
  const url = new URL(path, 'http://localhost:3000');
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { 'x-forwarded-for': o.ip ?? '10.0.0.1', ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.apiKey) headers['x-api-key'] = o.apiKey;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(url, { method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const res = await handler(req, { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, headers: res.headers, body: text && isJson ? JSON.parse(text) : null, text };
}

export async function seededDb(): Promise<TestDb & { ids: Awaited<ReturnType<typeof seedCore>> }> {
  process.env.DEMO_MODE = 'true';
  resetMemoryRateLimits();
  resetBreakers();
  setTransport(undefined);
  const t = await createTestDb();
  const ids = await seedCore(t.db, { staffPassword: TEST_PASSWORD, citizenPin: TEST_PIN, shopkeeperPassword: TEST_SHOP_PASSWORD });
  return { ...t, ids };
}

/** core + generated data (mock registries, rule sets, models, families) + optional demo fixtures */
export async function fullSeededDb(o: { demoCases?: boolean } = {}) {
  const t = await seededDb();
  const { seedGenerated } = await import('@/services/seed/generated');
  const { hashSecret } = await import('@/auth/crypto');
  await seedGenerated(t.db, t.ids, { citizenPinHash: await hashSecret(TEST_PIN) });
  if (o.demoCases) {
    const { seedDemoCases } = await import('@/services/seed/demo-cases');
    await seedDemoCases(t.db, t.ids);
  }
  return t;
}

/** a ready-made Idempotency-Key header */
export const idem = (k?: string) => ({ 'idempotency-key': k ?? `test-${crypto.randomUUID()}` });
