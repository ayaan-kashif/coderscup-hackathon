import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { anchorChains, emitEvent, lastAnchors, retentionSweep, signWebhook } from '@/services/jobs';
import * as webhooksRoute from '../../app/api/v1/admin/webhooks/route';
import * as webhookByIdRoute from '../../app/api/v1/admin/webhooks/[id]/route';
import * as deliveriesRoute from '../../app/api/v1/admin/webhooks/deliveries/route';
import * as replayRoute from '../../app/api/v1/admin/webhooks/deliveries/[id]/replay/route';

import * as anchorsRoute from '../../app/api/v1/audit/anchors/route';
import * as retentionRoute from '../../app/api/v1/admin/retention/route';
import * as outboxRoute from '../../app/api/v1/admin/outbox/route';
import { eq, isNotNull } from 'drizzle-orm';
import { citizens, notifications, outbox } from '@/db/schema/all';
import { notifyCitizen } from '@/services/notify';
import { dispatchOutbox } from '@/services/jobs';
import { flushDeferred } from '@/lib/defer';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
let adminTok: string;
let officerTok: string;

const staff = (email: string, role: 'officer' | 'admin' | 'auditor', tenant: string) =>
  signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]! });

beforeAll(async () => {
  t = await fullSeededDb() as never;
  adminTok = await staff('admin.sana@sindh.amanat.test', 'admin', 'sindh');
  officerTok = await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh');
});

afterAll(async () => {
  await flushDeferred();
  await t?.close();
});

describe('Webhooks & Background Jobs (API-5, AUD-3, §22.2)', () => {
  it('HMAC-SHA256 signs webhooks cleanly', () => {
    const sig = signWebhook('secret123', 1700000000, '{"event":"case.decided"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const sig2 = signWebhook('secret123', 1700000000, '{"event":"case.decided"}');
    expect(sig).toBe(sig2);
  });

  it('admin creates, lists, deactivates webhooks, and replays deliveries', async () => {
    // 1. non-admin gets 403
    const forbidden = await call(webhooksRoute.POST, '/api/v1/admin/webhooks', {
      token: officerTok,
      body: { url: 'https://external-partner.test/webhook', events: ['case.decided'] },
      headers: { 'Idempotency-Key': 'wh-key-1' },
    });
    expect(forbidden.status).toBe(403);

    // 2. admin creates endpoint
    const created = await call(webhooksRoute.POST, '/api/v1/admin/webhooks', {
      token: adminTok,
      body: { url: 'https://external-partner.test/webhook', events: ['case.decided', 'payment.sent'] },
      headers: { 'Idempotency-Key': 'wh-key-1' },
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.secret).toMatch(/^whsec_/);
    const endpointId = created.body.id;

    // 3. list endpoints
    const list = await call(webhooksRoute.GET, '/api/v1/admin/webhooks', { token: adminTok });
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: { id: string }) => i.id === endpointId)).toBe(true);

    // 4. emit event queues a delivery
    const count = await emitEvent(t.db, t.ids.tenantIds['sindh']!, 'case.decided', { caseId: 'test-case-1' });
    expect(count).toBeGreaterThanOrEqual(1);

    // 5. list deliveries
    const deliveries = await call(deliveriesRoute.GET, '/api/v1/admin/webhooks/deliveries', { token: adminTok });
    expect(deliveries.status).toBe(200);
    expect(deliveries.body.items.length).toBeGreaterThanOrEqual(1);
    const delivId = deliveries.body.items[0].id;

    // 6. replay delivery
    const replayed = await call(replayRoute.POST, `/api/v1/admin/webhooks/deliveries/${delivId}/replay`, {
      token: adminTok,
      params: { id: delivId },
      headers: { 'Idempotency-Key': 'wh-replay-1' },
    });
    expect(replayed.status).toBe(200);
    expect(replayed.body.enqueued).toBe(true);

    // 7. deactivate endpoint
    const revoked = await call(webhookByIdRoute.DELETE, `/api/v1/admin/webhooks/${endpointId}`, {
      token: adminTok,
      params: { id: endpointId },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
  });

  it('anchors audit chains and reports last head (AUD-3)', async () => {
    const anchors = await anchorChains(t.db);
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    expect(anchors[0]!.intact).toBe(true);

    const last = await lastAnchors(t.db);
    expect(last.length).toBeGreaterThanOrEqual(1);
    expect(last[0]!.verified_ok).toBe('true');
  });

  it('runs daily retention sweep (§22.2)', async () => {
    const summary = await retentionSweep(t.db);
    expect(summary).toBeDefined();
    expect(typeof summary.documents).toBe('number');
    expect(typeof summary.voiceAudio).toBe('number');
    expect(typeof summary.grantsExpired).toBe('number');
  });

  it('NOT-3: SMS and voice leave through the outbox with tracked status; failures retry with backoff', async () => {
    const [c0] = await t.db.select({ id: citizens.id }).from(citizens).where(isNotNull(citizens.userId)).limit(1);
    const c = { id: c0!.id, tenantId: t.ids.tenantIds['sindh']! };
    await notifyCitizen(t.db, { tenantId: c.tenantId, citizenId: c.id, key: 'in_review' });
    const rows = await t.db.select().from(outbox).where(eq(outbox.topic, 'notify.voice'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows.at(-1)!;
    expect(last.status).toBe('dispatched');
    // the phone number is never stored in clear in the outbox
    expect(JSON.stringify(last.payload)).not.toMatch(/\+?92\d{9,}|03\d{9}/);
    const notifId = (last.payload as { notificationId: string }).notificationId;
    const [n] = await t.db.select().from(notifications).where(eq(notifications.id, notifId));
    expect(n!.status).toBe('sent');

    // a failing row stays pending with a later nextAttemptAt, then fails after 6 attempts
    const [bad] = await t.db.insert(outbox).values({ tenantId: c.tenantId, topic: 'test.unknown', payload: {} }).returning();
    await dispatchOutbox(t.db);
    const [after1] = await t.db.select().from(outbox).where(eq(outbox.id, bad!.id));
    expect(after1!.status).toBe('pending');
    expect(after1!.attempts).toBe(1);
    expect(after1!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    for (let i = 0; i < 6; i++) {
      await t.db.update(outbox).set({ nextAttemptAt: new Date(0) }).where(eq(outbox.id, bad!.id));
      await dispatchOutbox(t.db);
    }
    const [final] = await t.db.select().from(outbox).where(eq(outbox.id, bad!.id));
    expect(final!.status).toBe('failed');
    expect(final!.lastError).toMatch(/unknown topic/);

    const stats = await call(outboxRoute.GET, '/api/v1/admin/outbox', { token: adminTok });
    expect(stats.status).toBe(200);
    expect(stats.body.items.some((i: { status: string }) => i.status === 'failed')).toBe(true);
  });

  it('AUD-3 and retention are reachable over the API by the right roles only', async () => {
    const auditorTok = await staff('auditor.raza@sindh.amanat.test', 'auditor', 'sindh');
    const post = await call(anchorsRoute.POST, '/api/v1/audit/anchors', { token: adminTok, body: {} });
    expect(post.status).toBe(200);
    const get = await call(anchorsRoute.GET, '/api/v1/audit/anchors', { token: auditorTok });
    expect(get.status).toBe(200);
    expect(get.body.items.length).toBeGreaterThanOrEqual(1);
    expect((await call(anchorsRoute.GET, '/api/v1/audit/anchors', { token: officerTok })).status).toBe(403);
    expect((await call(retentionRoute.POST, '/api/v1/admin/retention', { token: officerTok, body: {} })).status).toBe(403);
    const sweep = await call(retentionRoute.POST, '/api/v1/admin/retention', { token: adminTok, body: {} });
    expect(sweep.status).toBe(200);
    expect(typeof sweep.body.summary.documents).toBe('number');
  });
});
