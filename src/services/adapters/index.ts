/**
 * Adapters for the six mock services. Each method has a timeout, retries only when idempotent, and a circuit
 * breaker per service. A real registry, bank or SMS aggregator replaces one adapter, not the core (§18.4).
 * Responses are untrusted (§18.2) and are schema-validated before use.
 */
import { z } from 'zod';
import type { MockService } from '@/db/schema/all';
import { getDb } from '@/db/client';
import { ApiError } from '@/lib/errors';
import { randomId } from '@/lib/hash';
import { dispatchMock } from '../mocks/router';
import { CircuitBreaker, CircuitOpenError, TimeoutError, TransientError, withRetry, withTimeout } from './resilience';

export type Transport = (req: { method: 'GET' | 'POST'; path: string; query?: Record<string, string>; body?: unknown; signal: AbortSignal }) => Promise<{ status: number; body: unknown }>;

/** Calls the mock HTTP endpoints of a deployment (MOCK_BASE_URL). */
export const httpTransport = (baseUrl: string): Transport => async ({ method, path, query, body, signal }) => {
  const url = new URL(`/api/mock/${path}`, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { method, signal, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** Runs the same mock implementation in-process (default: no extra network hop on serverless). Chaos still applies. */
export const inProcessTransport: Transport = async ({ method, path, query, body, signal }) => {
  try {
    const out = await dispatchMock(getDb(), method, path, query ?? {}, body, signal);
    // round-trip through JSON so in-process answers look exactly like HTTP answers (dates as strings)
    return { status: out.status, body: JSON.parse(JSON.stringify(out.body)) };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { code: e.code, detail: e.detail } };
    throw e;
  }
};

let transport: Transport | undefined;
export function setTransport(t: Transport | undefined) { transport = t; }
function getTransport(): Transport {
  if (transport) return transport;
  const base = process.env.MOCK_BASE_URL;
  return base ? httpTransport(base) : inProcessTransport;
}

const breakers = new Map<MockService, CircuitBreaker>();
export function breaker(service: MockService) {
  let b = breakers.get(service);
  if (!b) { b = new CircuitBreaker(service); breakers.set(service, b); }
  return b;
}
export const breakerSnapshots = () => [...breakers.values()].map((b) => b.snapshot());
export const resetBreakers = () => breakers.clear();

/** PRD §22.1 per-step budgets */
const POLICY: Record<MockService, { timeoutMs: number; retries: number }> = {
  identity: { timeoutMs: 3000, retries: 3 },
  civil: { timeoutMs: 3000, retries: 3 },
  ledger: { timeoutMs: 3000, retries: 3 },
  sms: { timeoutMs: 3000, retries: 2 },
  complaints: { timeoutMs: 3000, retries: 2 },
  issuer: { timeoutMs: 2000, retries: 2 },
};

export type CallOpts = { idempotent: boolean; retryBaseMs?: number; sleep?: (ms: number) => Promise<void> };

/** One adapter call. Fails with DEPENDENCY_UNAVAILABLE (→ stop S8 in the pipeline), never with a guess. */
export async function callMock<T>(service: MockService, req: { method: 'GET' | 'POST'; path: string; query?: Record<string, string>; body?: unknown }, schema: z.ZodType<T>, opts: CallOpts): Promise<{ status: number; data: T | null }> {
  const p = POLICY[service];
  const b = breaker(service);
  try {
    return await withRetry(async () => {
      b.before();
      try {
        const res = await withTimeout(p.timeoutMs, (signal) => getTransport()({ ...req, signal }));
        if (res.status >= 500) throw new TransientError(`mock ${service} answered ${res.status}`, res.status);
        b.success();
        if (res.status === 404) return { status: 404, data: null };
        if (res.status >= 400) throw new ApiError('DEPENDENCY_UNAVAILABLE', `mock ${service} rejected the request (${res.status})`);
        const parsed = schema.safeParse(res.body);
        if (!parsed.success) throw new ApiError('DEPENDENCY_UNAVAILABLE', `mock ${service} returned an unexpected shape`);
        return { status: res.status, data: parsed.data };
      } catch (e) {
        if (e instanceof TimeoutError || e instanceof TransientError) b.failure();
        else if (!(e instanceof ApiError) && !(e instanceof CircuitOpenError)) { b.failure(); throw new TransientError(String(e)); }
        throw e;
      }
    }, { retries: opts.idempotent ? p.retries : 0, baseMs: opts.retryBaseMs ?? 200, maxMs: 2000, sleep: opts.sleep });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const why = e instanceof CircuitOpenError ? 'circuit open' : e instanceof TimeoutError ? 'timeout' : 'error';
    throw new ApiError('DEPENDENCY_UNAVAILABLE', `The ${service} service is unavailable (${why}). We are checking; you will hear from us.`, { extra: { service, reason: why } });
  }
}

// ---- typed adapters ----

const sim = z.object({ simulated: z.literal(true) });
const identityRecord = z.object({
  id: z.string(), cnic: z.string(), name: z.string(), nameUr: z.string().nullable(), relationName: z.string().nullable(),
  relation: z.string().nullable(), dob: z.string().nullable(), gender: z.enum(['F', 'M']), districtCode: z.string(),
  cardIssued: z.string().nullable(), cardExpiry: z.string().nullable(), status: z.string(),
});
const civilEvent = z.object({
  id: z.string(), eventType: z.enum(['death', 'marriage']), certificateNo: z.string(), subjectCnic: z.string(), subjectName: z.string(),
  spouseCnic: z.string().nullable(), spouseName: z.string().nullable(), eventDate: z.string(), districtCode: z.string(),
});

export const identityRegistry = {
  byCnic: (cnic: string) => callMock('identity', { method: 'GET', path: `identity/${encodeURIComponent(cnic)}` }, sim.extend({ records: z.array(identityRecord) }), { idempotent: true }),
  search: (q: { cnic?: string; name?: string; relationName?: string; dob?: string; districtCode?: string }) =>
    callMock('identity', { method: 'POST', path: 'identity/search', body: q }, sim.extend({ candidates: z.array(identityRecord) }), { idempotent: true }),
};

export const civilRegistry = {
  death: (q: { certificateNo?: string; cnic?: string }) =>
    callMock('civil', { method: 'GET', path: 'civil/death', query: q as Record<string, string> }, sim.extend({ events: z.array(civilEvent) }), { idempotent: true }),
  marriage: (cnic: string) => callMock('civil', { method: 'GET', path: 'civil/marriage', query: { cnic } }, sim.extend({ events: z.array(civilEvent) }), { idempotent: true }),
};

export const paymentLedger = {
  list: (q: { cnic?: string; walletNo?: string }) =>
    callMock('ledger', { method: 'GET', path: 'ledger/payments', query: q as Record<string, string> }, sim.extend({ payments: z.array(z.object({ ref: z.string(), amount: z.number(), programCode: z.string(), createdAt: z.string() }).passthrough()) }), { idempotent: true }),
  /** idempotent by key, so it may be retried */
  record: (p: { walletNo: string; recipientCnic: string; programCode: string; amount: number; idempotencyKey: string }) =>
    callMock('ledger', { method: 'POST', path: 'ledger/payments', body: p }, sim.extend({ payment: z.object({ ref: z.string() }).passthrough() }), { idempotent: true }),
};

export const smsGateway = {
  /** Not idempotent at the gateway, so never retried (a duplicate OTP SMS is worse than a retry prompt). */
  send: (to: string, body: string, kind: 'otp' | 'notification' | 'other' = 'notification') =>
    callMock('sms', { method: 'POST', path: 'sms/send', body: { to, body, kind, from: '8171-MOCK' } }, sim.extend({ messageId: z.string() }), { idempotent: false }),
  ivrCall: (to: string, script: string, objectionDigit?: string) =>
    callMock('sms', { method: 'POST', path: 'ivr/call', body: { to, script, objectionDigit } }, sim.extend({ callId: z.string() }), { idempotent: false }),
};

export const complaintSystem = {
  file: (c: { type: string; caseRef?: string; summary: string }) =>
    callMock('complaints', { method: 'POST', path: 'complaints', body: c }, sim.extend({ ref: z.string() }), { idempotent: false }),
  get: (ref: string) => callMock('complaints', { method: 'GET', path: `complaints/${encodeURIComponent(ref)}` }, sim.extend({ ref: z.string(), status: z.string() }), { idempotent: true }),
};

export const documentIssuer = {
  keys: () => callMock('issuer', { method: 'GET', path: 'issuer/keys' }, sim.extend({ keys: z.array(z.object({ kid: z.string(), alg: z.string(), publicKey: z.string(), status: z.string() })) }), { idempotent: true }),
};

export const newIdempotencyKey = () => randomId('idk', 20);
