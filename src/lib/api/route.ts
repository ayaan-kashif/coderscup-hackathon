import { NextResponse } from 'next/server';
import { z, type ZodType } from 'zod';
import type { Actor } from '@/auth/actor';
import { auditActorType } from '@/auth/actor';
import { authenticate } from '@/auth/authenticate';
import { authorize, type Action, type ResourceRef, type Verdict } from '@/auth/policy';
import { dbPolicyDeps } from '@/auth/policy-deps';
import { getDb, type Db, type DbOrTx } from '@/db/client';
import { writeAudit, type AuditInput } from '../audit';
import { ApiError, notFound, toProblem, type ErrorCode } from '../errors';
import { hashJson, randomId } from '../hash';
import { claimIdempotencyKey, completeIdempotencyKey } from '../idempotency';
import { log } from '../log';
import { checkLimits, type LimitResult, type LimitRule } from '../rate-limit';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Ctx<B, Q, P> = {
  req: Request;
  requestId: string;
  ip: string;
  actor: Actor | null;
  tenantIsSandbox?: boolean;
  body: B;
  query: Q;
  params: P;
  verdict?: Extract<Verdict, { allow: true }>;
  resource?: LoadedResource;
  /** work that must run only after the transaction commits (e.g. sending a mock SMS) */
  afterCommit: (fn: () => Promise<void>) => void;
  /** extra audit events written in the same transaction (e.g. a data read on a second resource) */
  audit: (e: Omit<AuditInput, 'requestId' | 'actorType' | 'actorId'> & Partial<Pick<AuditInput, 'actorType' | 'actorId'>>) => void;
};

export type LoadedResource = ResourceRef & { id?: string; [k: string]: unknown };

export type Cookie = { name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none'; path?: string; maxAge?: number };

export type HandlerResult = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
  cookies?: Cookie[];
  /** a non-JSON response (e.g. the HTML API reference); headers from the guard chain are still added */
  raw?: { body: string; contentType: string };
  /** overrides for the automatic audit event */
  audit?: { resourceId?: string | null; subjectCitizenId?: string | null; tenantId?: string | null; details?: Record<string, unknown>; outcome?: 'allowed' | 'denied' };
};

export type RouteSpec<B, Q, P> = {
  operationId: string;
  method: Method;
  /** OpenAPI path, e.g. /api/v1/cases/{id} */
  path: string;
  summary: string;
  tags: string[];
  auth: 'public' | 'optional' | 'required';
  /** minimum citizen stage; default 'full' (PIN verified) */
  citizenStage?: 'otp' | 'full';
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  response?: ZodType;
  responseStatus?: number;
  /** extra rate-limit rules on top of the per-IP and per-actor defaults */
  rateLimit?: (c: { ip: string; actor: Actor | null; body: B }) => LimitRule[];
  authorize?: { action: Action; resource?: (c: Ctx<B, Q, P>, db: DbOrTx) => Promise<LoadedResource | null> };
  /** API-3: required on creates and money writes */
  idempotency?: 'required' | 'optional' | 'none';
  audit?: { action: string; resourceType: string } | false;
  /** run the handler in one transaction together with its audit event (default true) */
  transaction?: boolean;
  /** simulated (mock) endpoints are labelled in docs and headers */
  simulated?: boolean;
};

export type RouteDef<B, Q, P> = RouteSpec<B, Q, P> & { handler: (c: Ctx<B, Q, P>, db: DbOrTx) => Promise<HandlerResult> };

const STAGE_RANK = { otp: 1, full: 2 } as const;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '0.0.0.0';
}

function zodIssues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

function parseWith<T>(schema: ZodType<T> | undefined, value: unknown, where: string): T {
  if (!schema) return undefined as T;
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError('VALIDATION_FAILED', `Invalid ${where}.`, { extra: { errors: zodIssues(r.error) } });
  return r.data;
}

function rateHeaders(r: LimitResult | null, nowMs: number): Record<string, string> {
  if (!r) return {};
  const resetSec = Math.max(0, Math.ceil((r.reset - nowMs) / 1000));
  return { 'RateLimit-Limit': String(r.limit), 'RateLimit-Remaining': String(r.remaining), 'RateLimit-Reset': String(resetSec) };
}

function actorKey(a: Actor | null) {
  return a ? `${a.kind}:${a.id}${a.tenantId ? `@${a.tenantId}` : ''}` : 'anon';
}

/**
 * The one guard chain (PRD §18.1):
 * request ID → authenticate → rate limit → validate → authorize (role → tenant → grant → consent)
 * → Idempotency-Key → one transaction that also writes the audit event → RFC 9457 errors.
 */
export function route<B = undefined, Q = undefined, P = undefined>(def: RouteDef<B, Q, P>) {
  const handler = async (req: Request, routeCtx?: { params?: Promise<Record<string, string | string[]>> }) => {
    const started = Date.now();
    const incoming = req.headers.get('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomId('req');
    const ip = clientIp(req);
    let headers: Record<string, string> = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
    if (def.simulated) headers['X-Simulated'] = 'true';
    let actor: Actor | null = null;
    let db: Db | undefined;

    try {
      db = getDb();

      // 1. authenticate
      let tenantIsSandbox: boolean | undefined;
      if (def.auth !== 'public') {
        const a = await authenticate(req, db);
        actor = a.actor;
        tenantIsSandbox = a.tenantIsSandbox;
      }
      if (def.auth === 'required' && !actor) throw new ApiError('UNAUTHENTICATED', 'Sign in, or send "Authorization: Bearer <token>" or "X-API-Key: <key>".');
      if (actor?.role === 'citizen') {
        const need = def.citizenStage ?? 'full';
        if (STAGE_RANK[actor.stage ?? 'otp'] < STAGE_RANK[need]) throw new ApiError('UNAUTHENTICATED', 'Enter your PIN to continue.', { extra: { next: 'pin' } });
      }
      // CSRF: cookie-authenticated writes must come from our own origin (Bearer and API keys need no Origin)
      if (actor?.via === 'cookie' && def.method !== 'GET') {
        const origin = req.headers.get('origin');
        const self = new URL(req.url).origin;
        if (origin && origin !== self) throw new ApiError('FORBIDDEN_ROLE', 'Cross-origin request with a session cookie.');
      }

      // 2. body is read before rate limiting so per-phone OTP rules can key on it
      let rawBody: unknown;
      if (def.body) {
        const text = await req.text();
        if (text.length > 1_000_000) throw new ApiError('PAYLOAD_TOO_LARGE', 'Request body over 1 MB.');
        try { rawBody = text ? JSON.parse(text) : {}; } catch { throw new ApiError('BAD_REQUEST', 'The body is not valid JSON.'); }
      }

      // 3. rate limit: per IP, per actor, plus route rules
      const nowMs = Date.now();
      const rules: LimitRule[] = [
        { name: 'ip', key: ip, limit: 300, windowSec: 60 },
        ...(actor ? [{ name: actor.kind === 'api_key' ? 'api_key' : 'actor', key: actorKey(actor), limit: actor.kind === 'api_key' ? 60 : 120, windowSec: 60 }] : []),
        ...(def.rateLimit?.({ ip, actor, body: rawBody as B }) ?? []),
      ];
      const rl = await checkLimits(rules, nowMs);
      headers = { ...headers, ...rateHeaders(rl.tightest, nowMs) };
      if (!rl.ok) {
        const retry = Math.max(1, Math.ceil(((rl.tightest?.reset ?? nowMs + 60_000) - nowMs) / 1000));
        throw new ApiError('RATE_LIMITED', `Too many requests. Retry after ${retry} seconds.`, { headers: { 'Retry-After': String(retry) }, extra: { limit: rl.failed?.name } });
      }

      // 4. validate
      const url = new URL(req.url);
      const params = parseWith(def.params, routeCtx?.params ? await routeCtx.params : {}, 'path parameters');
      const query = parseWith(def.query, Object.fromEntries(url.searchParams), 'query');
      const body = parseWith(def.body, rawBody, 'body');

      const extraAudit: AuditInput[] = [];
      const afterCommitFns: (() => Promise<void>)[] = [];
      const ctx: Ctx<B, Q, P> = {
        req, requestId, ip, actor, tenantIsSandbox, body, query, params,
        afterCommit: (fn) => afterCommitFns.push(fn),
        audit: (e) => extraAudit.push({ requestId, actorType: e.actorType ?? auditActorType(actor), actorId: e.actorId ?? actor?.id ?? 'anonymous', ...e }),
      };

      // 5. authorize
      if (def.authorize) {
        if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
        const resource = def.authorize.resource ? await def.authorize.resource(ctx, db) : {};
        if (resource === null) {
          await auditDenial(db, ctx, def, 'NOT_FOUND', 'UNKNOWN_ID');
          throw notFound('UNKNOWN_ID');
        }
        const verdict = await authorize(actor, def.authorize.action, { ...resource, tenantIsSandbox: resource.tenantIsSandbox ?? tenantIsSandbox }, dbPolicyDeps(db));
        if (!verdict.allow) {
          await auditDenial(db, ctx, def, verdict.code, verdict.reason, resource);
          if (verdict.code === 'NOT_FOUND') throw notFound(verdict.reason);
          throw new ApiError(verdict.code, undefined, { auditReason: verdict.reason });
        }
        ctx.verdict = verdict;
        ctx.resource = resource;
      }

      // 6. idempotency key
      const idemKey = req.headers.get('idempotency-key');
      if (def.idempotency === 'required' && !idemKey) {
        throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 'This request creates a record or moves money, so it needs an Idempotency-Key header, for example: "Idempotency-Key: 6f1c2a7e-3b4d-4c55-9a10-2f8e7d1b0c99". Reuse the same key when you retry.');
      }
      if (idemKey && !IDEMPOTENCY_KEY_RE.test(idemKey)) throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key must be 8–128 characters of letters, digits, _ . : -');
      const useIdem = def.idempotency !== 'none' && def.idempotency !== undefined && !!idemKey;

      // 7. execute in one transaction together with the audit event
      const run = async (dbx: DbOrTx) => {
        if (useIdem) {
          const stored = await claimIdempotencyKey(dbx as never, {
            actor: actorKey(actor), key: idemKey!, method: def.method, path: url.pathname, requestHash: hashJson(rawBody ?? null),
          });
          if (stored) return { replay: true as const, result: { status: stored.status, body: stored.body } as HandlerResult };
        }
        const result = await def.handler(ctx, dbx);
        if (def.audit) {
          await writeAudit(dbx, {
            requestId, actorType: auditActorType(actor), actorId: actor?.id ?? 'anonymous',
            tenantId: result.audit?.tenantId !== undefined ? result.audit.tenantId : (ctx.resource?.tenantId ?? actor?.tenantId ?? null),
            subjectCitizenId: result.audit?.subjectCitizenId !== undefined ? result.audit.subjectCitizenId : (ctx.resource?.citizenId ?? null),
            action: def.audit.action, resourceType: def.audit.resourceType,
            resourceId: result.audit?.resourceId ?? ctx.resource?.id ?? null,
            outcome: result.audit?.outcome ?? 'allowed',
            details: { ...(result.audit?.details ?? {}), ...(idemKey ? { idempotencyKey: idemKey } : {}) },
          });
        }
        for (const e of extraAudit) await writeAudit(dbx, e);
        if (useIdem) await completeIdempotencyKey(dbx as never, actorKey(actor), idemKey!, { status: result.status ?? 200, body: result.body });
        return { replay: false as const, result };
      };
      const { replay, result } = def.transaction === false ? await run(db) : await db.transaction((tx) => run(tx));

      if (!replay) for (const fn of afterCommitFns) await fn();

      if (result.raw) {
        return new NextResponse(result.raw.body, { status: result.status ?? 200, headers: { ...headers, ...(result.headers ?? {}), 'Content-Type': result.raw.contentType } });
      }
      const res = NextResponse.json(result.body, { status: result.status ?? 200, headers: { ...headers, ...(result.headers ?? {}), ...(replay ? { 'Idempotent-Replayed': 'true' } : {}) } });
      for (const c of result.cookies ?? []) res.cookies.set(c);
      log('info', 'request', { requestId, op: def.operationId, status: res.status, ms: Date.now() - started, actor: actor?.kind, replay });
      return res;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('INTERNAL', 'Unexpected error. Quote the request ID to staff.');
      if (!(e instanceof ApiError)) {
        log('error', 'unhandled', { requestId, op: def.operationId, error: e instanceof Error ? e.stack ?? e.message : String(e) });
        if (db) await writeAudit(db, { requestId, actorType: auditActorType(actor), actorId: actor?.id ?? 'anonymous', tenantId: actor?.tenantId ?? null, action: def.audit ? def.audit.action : def.operationId, resourceType: def.audit ? def.audit.resourceType : 'request', outcome: 'error', details: { code: 'INTERNAL' } }).catch(() => {});
      }
      return NextResponse.json(toProblem(err, requestId), { status: err.status, headers: { ...headers, ...err.headers, 'Content-Type': 'application/problem+json' } });
    }
  };
  return Object.assign(handler, { spec: def as RouteSpec<B, Q, P> });
}

/** AUD-1 + §13.2: every denial is an audit event with outcome = denied and the real reason. */
async function auditDenial<B, Q, P>(db: Db, ctx: Ctx<B, Q, P>, def: RouteDef<B, Q, P>, code: string, reason: string, resource?: LoadedResource) {
  await writeAudit(db, {
    requestId: ctx.requestId,
    actorType: auditActorType(ctx.actor),
    actorId: ctx.actor?.id ?? 'anonymous',
    // a denial is recorded in the actor's own chain: the other tenant's chain must not learn about the probe
    tenantId: ctx.actor?.tenantId ?? null,
    subjectCitizenId: code === 'CONSENT_WITHDRAWN' ? (resource?.citizenId ?? null) : null,
    action: def.audit ? def.audit.action : def.operationId,
    resourceType: def.audit ? def.audit.resourceType : 'request',
    resourceId: resource?.id ?? null,
    outcome: 'denied',
    details: { code, reason },
  }).catch((e) => log('error', 'audit denial failed', { requestId: ctx.requestId, error: String(e) }));
}

export type RouteHandler = ReturnType<typeof route>;

/**
 * An error response that still COMMITS the transaction — for failures whose side effects must persist,
 * such as counting a wrong PIN toward the lockout. Audited as denied.
 */
export function problemResult(c: { requestId: string }, code: ErrorCode, detail?: string, extra?: Record<string, unknown>): HandlerResult {
  const err = new ApiError(code, detail, { extra });
  return { status: err.status, body: toProblem(err, c.requestId), headers: { 'Content-Type': 'application/problem+json' }, audit: { outcome: 'denied', details: { code } } };
}
