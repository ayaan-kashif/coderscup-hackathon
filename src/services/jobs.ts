import 'server-only';
/**
 * Background work that must survive failures (PRD §22.2):
 *  - NOT-3 notification delivery through the transactional outbox, with retries and tracked status;
 *  - API-5 webhooks: HMAC-SHA256 over "timestamp.body", retries with backoff, a delivery log and replay;
 *  - AUD-3 the hourly audit anchor (head hash of every chain, verified first);
 *  - the daily retention sweep (expired documents and voice, grants and consents), each deletion audited.
 * Run by Inngest crons when configured, otherwise kicked after the request that queued the work.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, lte, lt, sql } from 'drizzle-orm';
import { decryptPii, encryptPii } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { getDb } from '@/db/client';
import { rowsOf } from '@/db/rows';
import {
  auditAnchors, auditChainHeads, cases, consents, documents, helperAssignments, helperGrants, notifications, outbox, scamReports, voiceInputs, webhookDeliveries, webhookEndpoints,
} from '@/db/schema/all';
import { verifyChain, writeAudit } from '@/lib/audit';
import { defer } from '@/lib/defer';
import { log } from '@/lib/log';
import { smsGateway } from './adapters';

const SYSTEM = { actorType: 'system' as const, actorId: 'jobs' };
const MAX_ATTEMPTS = 6;
/** 1, 2, 4, 8, 16 minutes, then give up (failed, visible in the delivery log) */
const backoff = (attempts: number) => new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000);

export async function enqueue(db: DbOrTx, tenantId: string | null, topic: 'notify.sms' | 'notify.voice' | 'webhook.deliver', payload: Record<string, unknown>) {
  const [row] = await db.insert(outbox).values({ tenantId, topic, payload }).returning();
  return row!;
}

let kicking = false;
/** run the dispatcher soon (after the response, or now in scripts and tests) */
export function kickDispatch() {
  if (kicking) return;
  kicking = true;
  defer(async () => { try { await dispatchOutbox(getDb()); } finally { kicking = false; } });
}

type OutboxRow = typeof outbox.$inferSelect;

/** claim and deliver one row; on failure it stays pending with backoff, or fails after MAX_ATTEMPTS */
export async function processRow(db: DbOrTx, row: OutboxRow): Promise<'sent' | 'failed' | 'skipped'> {
  // claim the row (another worker may race us)
  const claimed = await db.update(outbox).set({ attempts: row.attempts + 1, nextAttemptAt: backoff(row.attempts + 1) }).where(and(eq(outbox.id, row.id), eq(outbox.attempts, row.attempts), eq(outbox.status, 'pending'))).returning({ id: outbox.id });
  if (!claimed.length) return 'skipped';
  try {
    await deliver(db, row.topic, row.payload as Record<string, unknown>);
    await db.update(outbox).set({ status: 'dispatched', dispatchedAt: new Date(), lastError: null }).where(eq(outbox.id, row.id));
    return 'sent';
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    const give = row.attempts + 1 >= MAX_ATTEMPTS;
    await db.update(outbox).set({ status: give ? 'failed' : 'pending', lastError: msg }).where(eq(outbox.id, row.id));
    await onFailure(db, row.topic, row.payload as Record<string, unknown>, give, row.attempts + 1);
    return 'failed';
  }
}

/** one pass over due outbox rows; each row is delivered at most once per pass and retried with backoff */
export async function dispatchOutbox(db: DbOrTx, limit = 50) {
  const due = await db.select().from(outbox).where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, new Date()))).orderBy(asc(outbox.createdAt)).limit(limit);
  let sent = 0, failed = 0;
  for (const row of due) {
    const r = await processRow(db, row);
    if (r === 'sent') sent++;
    else if (r === 'failed') failed++;
  }
  return { due: due.length, sent, failed };
}

/** outbox health for the status page and the admin console */
export async function outboxStats(db: DbOrTx) {
  const rows = rowsOf<{ status: string; topic: string; n: number }>(await db.execute(sql`select status, topic, count(*)::int as n from outbox group by status, topic`));
  return rows;
}

async function deliver(db: DbOrTx, topic: string, p: Record<string, unknown>) {
  if (topic === 'notify.sms' || topic === 'notify.voice') {
    const id = String(p.notificationId);
    const [n] = await db.select({ status: notifications.status, attempts: notifications.attempts }).from(notifications).where(eq(notifications.id, id)).limit(1);
    if (!n || n.status === 'sent') return;
    const to = typeof p.toEnc === 'string' ? decryptPii(Buffer.from(p.toEnc, 'base64')) : String(p.to);
    if (topic === 'notify.sms') await smsGateway.send(to, String(p.text), 'notification', 'SAAYA');
    else await smsGateway.ivrCall(to, String(p.text));
    await db.update(notifications).set({ status: 'sent', sentAt: new Date(), attempts: n.attempts + 1 }).where(eq(notifications.id, id));
    return;
  }
  if (topic === 'webhook.deliver') return deliverWebhook(db, String(p.deliveryId));
  throw new Error(`unknown topic ${topic}`);
}

async function onFailure(db: DbOrTx, topic: string, p: Record<string, unknown>, gaveUp: boolean, attempts: number) {
  if (topic.startsWith('notify.')) await db.update(notifications).set({ attempts, ...(gaveUp ? { status: 'failed' as const } : {}) }).where(eq(notifications.id, String(p.notificationId)));
  if (topic === 'webhook.deliver') await db.update(webhookDeliveries).set({ attempts, nextAttemptAt: gaveUp ? null : backoff(attempts), ...(gaveUp ? { status: 'failed' as const } : {}) }).where(eq(webhookDeliveries.id, String(p.deliveryId)));
}

// ---------------------------------------------------------------- webhooks (API-5)
export const WEBHOOK_EVENTS = ['case.decided', 'case.escalated', 'payment.sent', 'consent.withdrawn'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** the signature receivers check: hex HMAC-SHA256 of "<timestamp>.<body>"; reject anything older than 5 minutes */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export async function createEndpoint(db: DbOrTx, tenantId: string, url: string, events: WebhookEvent[]) {
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const [e] = await db.insert(webhookEndpoints).values({ tenantId, url, secretEnc: encryptPii(secret), events: [...events] }).returning({ id: webhookEndpoints.id });
  return { id: e!.id, secret };
}

export async function listEndpoints(db: DbOrTx, tenantId: string) {
  return db.select({
    id: webhookEndpoints.id,
    url: webhookEndpoints.url,
    events: webhookEndpoints.events,
    active: webhookEndpoints.active,
    createdAt: webhookEndpoints.createdAt,
  }).from(webhookEndpoints).where(eq(webhookEndpoints.tenantId, tenantId)).orderBy(asc(webhookEndpoints.createdAt));
}

export async function revokeEndpoint(db: DbOrTx, tenantId: string, endpointId: string): Promise<boolean> {
  const result = await db.update(webhookEndpoints).set({ active: false }).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, tenantId))).returning({ id: webhookEndpoints.id });
  return result.length > 0;
}

export async function listDeliveries(db: DbOrTx, tenantId: string, limit = 50) {
  return db.select({
    id: webhookDeliveries.id,
    endpointId: webhookDeliveries.endpointId,
    event: webhookDeliveries.event,
    status: webhookDeliveries.status,
    attempts: webhookDeliveries.attempts,
    responseStatus: webhookDeliveries.responseStatus,
    nextAttemptAt: webhookDeliveries.nextAttemptAt,
    createdAt: webhookDeliveries.createdAt,
  }).from(webhookDeliveries).where(eq(webhookDeliveries.tenantId, tenantId)).orderBy(sql`${webhookDeliveries.createdAt} desc`).limit(limit);
}

/** queue an event for every subscribed endpoint of the tenant (ids, codes and amounts only — never personal data) */
export async function emitEvent(db: DbOrTx, tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const eps = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.active, true), sql`${event} = any(${webhookEndpoints.events})`));
  for (const ep of eps) {
    const [d] = await db.insert(webhookDeliveries).values({ endpointId: ep.id, tenantId, event, payload: { id: `evt_${randomBytes(8).toString('hex')}`, event, createdAt: new Date().toISOString(), data } }).returning({ id: webhookDeliveries.id });
    await enqueue(db, tenantId, 'webhook.deliver', { deliveryId: d!.id });
  }
  if (eps.length) kickDispatch();
  return eps.length;
}

async function deliverWebhook(db: DbOrTx, deliveryId: string) {
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!d || d.status === 'delivered') return;
  const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId)).limit(1);
  if (!ep?.active) throw new Error('endpoint inactive');
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = signWebhook(decryptPii(ep.secretEnc), ts, body);
  const r = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Amanat-Event': d.event, 'X-Amanat-Timestamp': String(ts), 'X-Amanat-Signature': `t=${ts},v1=${sig}` }, body, signal: AbortSignal.timeout(5000), redirect: 'error' });
  await db.update(webhookDeliveries).set({ responseStatus: r.status, attempts: d.attempts + 1 }).where(eq(webhookDeliveries.id, d.id));
  if (!r.ok) throw new Error(`receiver answered ${r.status}`);
  await db.update(webhookDeliveries).set({ status: 'delivered', nextAttemptAt: null }).where(eq(webhookDeliveries.id, d.id));
}

/** replay: a delivered or failed delivery is sent again (same payload, new signature).
 *  When tenantId is supplied the delivery must belong to that tenant (returns false if not found). */
export async function replayDelivery(db: DbOrTx, deliveryId: string, tenantId?: string): Promise<boolean> {
  const where = tenantId
    ? and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.tenantId, tenantId))
    : eq(webhookDeliveries.id, deliveryId);
  const [d] = await db.select({ tenantId: webhookDeliveries.tenantId }).from(webhookDeliveries).where(where).limit(1);
  if (!d) return false;
  await db.update(webhookDeliveries).set({ status: 'pending' }).where(eq(webhookDeliveries.id, deliveryId));
  await enqueue(db, d.tenantId, 'webhook.deliver', { deliveryId });
  kickDispatch();
  return true;
}

// ---------------------------------------------------------------- audit anchor (AUD-3)
export async function anchorChains(db: DbOrTx) {
  const heads = await db.select().from(auditChainHeads);
  const out = [];
  for (const h of heads) {
    const v = await verifyChain(db, h.chainId);
    await db.insert(auditAnchors).values({ chainId: h.chainId, seq: h.lastSeq, headHash: h.lastHash, verifiedOk: v.intact ? 'true' : `broken:${v.brokenAt ?? 'tail'}` });
    out.push({ chainId: h.chainId, seq: h.lastSeq, intact: v.intact });
  }
  return out;
}

export async function lastAnchors(db: DbOrTx) {
  return rowsOf<{ chain_id: string; seq: number; head: string; verified_ok: string; created_at: string }>(await db.execute(sql`
    select distinct on (chain_id) chain_id, seq, encode(head_hash, 'hex') as head, verified_ok, created_at from audit_anchors order by chain_id, created_at desc`));
}

// ---------------------------------------------------------------- retention sweep (§22.2, §23.4)
export const RETENTION = { documentDaysAfterClose: 90, voiceAudioDays: 7, scamTextDays: 90 };

export async function retentionSweep(db: DbOrTx) {
  const docs = await db.update(documents).set({ contentEnc: null }).where(and(isNotNull(documents.contentEnc), sql`${documents.caseId} in (select id from cases where status in ('closed','confirmed','rejected') and updated_at < now() - make_interval(days => ${RETENTION.documentDaysAfterClose}))`)).returning({ id: documents.id });
  const voice = await db.update(voiceInputs).set({ audioEnc: null, audioDeletedAt: new Date() }).where(and(isNotNull(voiceInputs.audioEnc), lt(voiceInputs.createdAt, sql`now() - make_interval(days => ${RETENTION.voiceAudioDays})`))).returning({ id: voiceInputs.id });
  const scam = await db.update(scamReports).set({ messageText: null }).where(and(isNotNull(scamReports.messageText), lt(scamReports.createdAt, sql`now() - make_interval(days => ${RETENTION.scamTextDays})`))).returning({ id: scamReports.id });
  const grants = await db.update(helperGrants).set({ revokedAt: new Date() }).where(and(isNull(helperGrants.revokedAt), lte(helperGrants.expiresAt, new Date()))).returning({ id: helperGrants.id });
  const assigns = await db.update(helperAssignments).set({ status: 'expired' }).where(and(eq(helperAssignments.status, 'active'), lte(helperAssignments.expiresAt, new Date()))).returning({ id: helperAssignments.id });
  const cons = await db.update(consents).set({ status: 'expired' }).where(and(eq(consents.status, 'active'), isNotNull(consents.expiresAt), lte(consents.expiresAt, new Date()))).returning({ id: consents.id, citizenId: consents.citizenId, tenantId: consents.tenantId });
  // an expired consent is treated as withdrawn (§27.3): her open cases pause
  if (cons.length) await db.update(cases).set({ status: 'paused_for_consent' }).where(and(inArray(cases.citizenId, cons.map((c) => c.citizenId)), sql`${cases.status} not in ('closed','rejected','paid','confirmed','draft')`));
  const { pruneTtsCache } = await import('./tts');
  const ttsPruned = await pruneTtsCache(db);
  const summary = { documents: docs.length, voiceAudio: voice.length, scamTexts: scam.length, grantsExpired: grants.length, assignmentsExpired: assigns.length, consentsExpired: cons.length, ttsPruned };
  await writeAudit(db, { ...SYSTEM, actorId: 'retention.sweep', action: 'retention.sweep', resourceType: 'system', outcome: 'allowed', details: summary });
  for (const c of cons) await writeAudit(db, { ...SYSTEM, actorId: 'retention.sweep', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'consent.expired', resourceType: 'consent', resourceId: c.id, outcome: 'allowed' });
  log('info', 'retention sweep', summary);
  return summary;
}
