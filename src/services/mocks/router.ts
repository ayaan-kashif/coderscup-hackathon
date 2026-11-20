/**
 * The six SIMULATED services of PRD §21.3. Every response carries `simulated: true` and every request first
 * passes through the chaos settings of its service. Nothing here moves money or reaches a real phone.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import {
  mockCivilEvents, mockComplaints, mockIdentityRecords, mockIssuerKeys, mockLedgerTransactions, mockSmsMessages, mockWallets,
  type MockService,
} from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { randomId } from '@/lib/hash';
import { applyChaos, getChaos } from './chaos';

export const CNIC_RE = /^00000-\d{7}-\d$/;
export const MOCK_PHONE_RE = /^\+9200000\d{5}$/;
const cnic = z.string().regex(CNIC_RE, 'mock CNICs look like 00000-1234567-2');
const phone = z.string().regex(MOCK_PHONE_RE, 'mock phone numbers look like +920000000001');

type MockRoute = {
  service: MockService;
  method: 'GET' | 'POST';
  /** path under /api/mock, with :params */
  pattern: string;
  summary: string;
  query?: z.ZodType;
  body?: z.ZodType;
  run: (db: DbOrTx, a: { params: Record<string, string>; query: never; body: never }) => Promise<{ status?: number; body: Record<string, unknown> }>;
};

const identitySearch = z.object({
  cnic: cnic.optional(),
  name: z.string().min(2).max(80).optional(),
  relationName: z.string().max(80).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  districtCode: z.string().max(10).optional(),
}).refine((v) => v.cnic || v.name, 'give a cnic or a name');

const ledgerPost = z.object({
  walletNo: z.string().min(6).max(30),
  recipientCnic: cnic,
  programCode: z.string().min(2).max(20),
  amount: z.number().int().positive().max(1_000_000),
  idempotencyKey: z.string().min(8).max(128),
});

/** CNICs one digit away (edge case "CNIC off by one digit" → near agreement). */
function oneDigitVariants(c: string) {
  const digits = c.replace(/\D/g, '');
  const out: string[] = [];
  for (let i = 5; i < digits.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === digits[i]) continue;
      const v = digits.slice(0, i) + d + digits.slice(i + 1);
      out.push(`${v.slice(0, 5)}-${v.slice(5, 12)}-${v.slice(12)}`);
    }
  }
  return out;
}

export const MOCK_ROUTES: MockRoute[] = [
  {
    service: 'identity', method: 'GET', pattern: 'identity/:cnic', summary: 'Identity registry (NADRA-like): records for a CNIC',
    run: async (db, { params }) => {
      if (!CNIC_RE.test(params.cnic!)) throw new ApiError('VALIDATION_FAILED', 'mock CNICs look like 00000-1234567-2');
      const rows = await db.select().from(mockIdentityRecords).where(eq(mockIdentityRecords.cnic, params.cnic!));
      if (!rows.length) throw new ApiError('NOT_FOUND', 'No registry record for this CNIC.', { extra: { simulated: true } });
      return { body: { records: rows } };
    },
  },
  {
    service: 'identity', method: 'POST', pattern: 'identity/search', summary: 'Identity registry: candidate search by CNIC (exact or one digit off) or name',
    body: identitySearch,
    run: async (db, { body }) => {
      const b = body as z.infer<typeof identitySearch>;
      const conds = [];
      if (b.cnic) conds.push(inArray(mockIdentityRecords.cnic, [b.cnic, ...oneDigitVariants(b.cnic)]));
      if (b.name) {
        const nameCond = sql`similarity(lower(${mockIdentityRecords.name}), lower(${b.name})) > 0.3`;
        conds.push(b.districtCode ? and(nameCond, eq(mockIdentityRecords.districtCode, b.districtCode))! : nameCond);
      }
      const rows = await db.select().from(mockIdentityRecords).where(or(...conds)).limit(10);
      return { body: { candidates: rows } };
    },
  },
  {
    service: 'civil', method: 'GET', pattern: 'civil/death', summary: 'Civil registry: death events by certificate number or CNIC',
    query: z.object({ certificateNo: z.string().max(40).optional(), cnic: cnic.optional() }).refine((v) => v.certificateNo || v.cnic, 'give certificateNo or cnic'),
    run: async (db, { query }) => {
      const q = query as { certificateNo?: string; cnic?: string };
      const rows = await db.select().from(mockCivilEvents).where(and(eq(mockCivilEvents.eventType, 'death'),
        q.certificateNo ? eq(mockCivilEvents.certificateNo, q.certificateNo) : eq(mockCivilEvents.subjectCnic, q.cnic!)));
      return { body: { events: rows } };
    },
  },
  {
    service: 'civil', method: 'GET', pattern: 'civil/marriage', summary: 'Civil registry: marriage events by CNIC of either spouse',
    query: z.object({ cnic }),
    run: async (db, { query }) => {
      const q = query as { cnic: string };
      const rows = await db.select().from(mockCivilEvents).where(and(eq(mockCivilEvents.eventType, 'marriage'),
        or(eq(mockCivilEvents.subjectCnic, q.cnic), eq(mockCivilEvents.spouseCnic, q.cnic))));
      return { body: { events: rows } };
    },
  },
  {
    service: 'ledger', method: 'GET', pattern: 'ledger/payments', summary: 'Payment ledger (Raast-like): payments by recipient CNIC or wallet',
    query: z.object({ cnic: cnic.optional(), walletNo: z.string().max(30).optional() }).refine((v) => v.cnic || v.walletNo, 'give cnic or walletNo'),
    run: async (db, { query }) => {
      const q = query as { cnic?: string; walletNo?: string };
      const rows = await db.select().from(mockLedgerTransactions)
        .where(q.cnic ? eq(mockLedgerTransactions.recipientCnic, q.cnic) : eq(mockLedgerTransactions.walletNo, q.walletNo!))
        .orderBy(desc(mockLedgerTransactions.createdAt)).limit(50);
      return { body: { payments: rows } };
    },
  },
  {
    service: 'ledger', method: 'POST', pattern: 'ledger/payments', summary: 'Payment ledger: record a payment (never moves money; idempotent by key)',
    body: ledgerPost,
    run: async (db, { body }) => {
      const b = body as z.infer<typeof ledgerPost>;
      const [wallet] = await db.select().from(mockWallets).where(eq(mockWallets.walletNo, b.walletNo)).limit(1);
      if (!wallet) throw new ApiError('VALIDATION_FAILED', 'Unknown mock wallet.', { extra: { simulated: true } });
      const inserted = await db.insert(mockLedgerTransactions).values({ ...b, ref: randomId('LDG', 12).toUpperCase() })
        .onConflictDoNothing({ target: mockLedgerTransactions.idempotencyKey }).returning();
      if (inserted[0]) return { status: 201, body: { payment: inserted[0] } };
      const [existing] = await db.select().from(mockLedgerTransactions).where(eq(mockLedgerTransactions.idempotencyKey, b.idempotencyKey));
      return { body: { payment: existing, replayed: true } };
    },
  },
  {
    service: 'sms', method: 'POST', pattern: 'sms/send', summary: 'SMS gateway: write a message to the on-screen mock phone',
    body: z.object({ to: phone, from: z.string().max(20).default('8171-MOCK'), body: z.string().min(1).max(640), kind: z.enum(['otp', 'notification', 'other']).default('notification') }),
    run: async (db, { body }) => {
      const b = body as { to: string; from: string; body: string; kind: 'otp' | 'notification' | 'other' };
      const [m] = await db.insert(mockSmsMessages).values({ toPhone: b.to, fromSender: b.from, body: b.body, kind: b.kind }).returning({ id: mockSmsMessages.id, createdAt: mockSmsMessages.createdAt });
      return { status: 201, body: { messageId: m!.id, delivered: 'mock-phone-only', createdAt: m!.createdAt } };
    },
  },
  {
    service: 'sms', method: 'GET', pattern: 'sms/inbox', summary: 'SMS gateway: the mock phone inbox for one fictional number',
    query: z.object({ phone }),
    run: async (db, { query }) => {
      const q = query as { phone: string };
      const rows = await db.select().from(mockSmsMessages).where(eq(mockSmsMessages.toPhone, q.phone)).orderBy(desc(mockSmsMessages.createdAt)).limit(30);
      return { body: { phone: q.phone, messages: rows } };
    },
  },
  {
    service: 'sms', method: 'POST', pattern: 'ivr/call', summary: 'IVR gateway: place a simulated voice call (shows on the mock phone)',
    body: z.object({ to: phone, script: z.string().min(1).max(1000), objectionDigit: z.string().regex(/^\d$/).optional() }),
    run: async (db, { body }) => {
      const b = body as { to: string; script: string; objectionDigit?: string };
      const text = b.objectionDigit ? `${b.script} [Press ${b.objectionDigit} to object]` : b.script;
      const [m] = await db.insert(mockSmsMessages).values({ toPhone: b.to, fromSender: 'IVR-MOCK', body: text, kind: 'ivr' }).returning({ id: mockSmsMessages.id });
      return { status: 201, body: { callId: m!.id, status: 'completed-on-mock-phone' } };
    },
  },
  {
    service: 'complaints', method: 'POST', pattern: 'complaints', summary: 'Complaint system: file a complaint and get a reference number',
    body: z.object({ type: z.string().max(40), caseRef: z.string().max(80).optional(), summary: z.string().max(500) }),
    run: async (db, { body }) => {
      const ref = `MC-${randomId('x', 8).slice(2).toUpperCase()}`;
      await db.insert(mockComplaints).values({ ref, payload: body as object });
      return { status: 201, body: { ref, status: 'received' } };
    },
  },
  {
    service: 'complaints', method: 'GET', pattern: 'complaints/:ref', summary: 'Complaint system: status of a reference number',
    run: async (db, { params }) => {
      const [c] = await db.select().from(mockComplaints).where(eq(mockComplaints.ref, params.ref!)).limit(1);
      if (!c) throw new ApiError('NOT_FOUND', 'Unknown complaint reference.', { extra: { simulated: true } });
      return { body: { ref: c.ref, status: c.status, createdAt: c.createdAt } };
    },
  },
  {
    service: 'issuer', method: 'GET', pattern: 'issuer/keys', summary: 'Document issuer: Ed25519 public keys for signed-QR verification',
    run: async (db) => {
      const keys = await db.select({ kid: mockIssuerKeys.kid, alg: mockIssuerKeys.algorithm, publicKey: mockIssuerKeys.publicKey, status: mockIssuerKeys.status }).from(mockIssuerKeys);
      return { body: { keys } };
    },
  },
];

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

/** Dispatch one mock request: route match → chaos → validate → run. */
export async function dispatchMock(db: DbOrTx, method: string, path: string, query: Record<string, string>, rawBody: unknown, signal?: AbortSignal) {
  let found: { r: MockRoute; params: Record<string, string> } | undefined;
  // static segments win over params (identity/search before identity/:cnic)
  for (const r of [...MOCK_ROUTES].sort((a, b) => a.pattern.split(':').length - b.pattern.split(':').length)) {
    if (r.method !== method) continue;
    const params = match(r.pattern, path);
    if (params) { found = { r, params }; break; }
  }
  if (!found) throw new ApiError('NOT_FOUND', 'No such mock endpoint.', { extra: { simulated: true } });
  await applyChaos(await getChaos(db, found.r.service), found.r.service, signal);
  const q = found.r.query ? found.r.query.safeParse(query) : { success: true as const, data: {} };
  if (!q.success) throw new ApiError('VALIDATION_FAILED', 'Invalid query.', { extra: { errors: q.error.issues } });
  const b = found.r.body ? found.r.body.safeParse(rawBody ?? {}) : { success: true as const, data: undefined };
  if (!b.success) throw new ApiError('VALIDATION_FAILED', 'Invalid body.', { extra: { errors: b.error.issues } });
  const out = await found.r.run(db, { params: found.params, query: q.data as never, body: b.data as never });
  return { status: out.status ?? 200, body: { simulated: true, service: found.r.service, ...out.body } };
}

