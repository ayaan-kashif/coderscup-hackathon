import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { enqueue, OutboxDb } from '@/offline/outbox';
import { backoffMs, refreshTicks, syncOnce, type SyncDeps } from '@/offline/sync';

/** A fake server that is idempotent by key, like the real one (OFF-4). */
function fakeServer() {
  const byKey = new Map<string, { status: number; body: unknown }>();
  let cases = 0;
  let opened = new Set<string>();
  let mode: 'up' | 'down' | 'drop' | 'reject' = 'up';
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (url.endsWith('/status')) {
      const id = url.split('/').at(-2)!;
      return new Response(JSON.stringify({ ticks: opened.has(id) ? 'blue2' : 'grey2' }), { status: 200 });
    }
    if (mode === 'reject') return new Response(JSON.stringify({ code: 'VALIDATION_FAILED' }), { status: 422 });
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'] ?? '';
    let stored = byKey.get(key);
    if (!stored) {
      cases++;
      stored = { status: 201, body: { id: `case-${cases}`, status: 'draft', ticks: 2 } };
      byKey.set(key, stored);
    }
    // "drop": the server acts, but the connection dies before the phone hears back
    if (mode === 'drop') throw new TypeError('connection reset');
    return new Response(JSON.stringify(stored.body), { status: stored.status });
  }) as unknown as typeof fetch;
  return {
    fetchFn, get cases() { return cases; },
    set mode(m: typeof mode) { mode = m; },
    open: (id: string) => { opened = new Set([...opened, id]); },
  };
}

let db: OutboxDb;
let clock = 0;
let deps: SyncDeps;
let server: ReturnType<typeof fakeServer>;

beforeEach(async () => {
  db = new OutboxDb(`test-${Math.random()}`);
  clock = 1_000_000;
  server = fakeServer();
  deps = { fetch: server.fetchFn, now: () => clock, random: () => 0.5 };
});

describe('outbox and ticks (OFF-2, OFF-5)', () => {
  it('saves first (one grey tick), then two grey on ack, then blue when an officer opens it', async () => {
    const e = await enqueue(db, 'case.create', { programCode: 'SAAYA-WS', channel: 'citizen' }, clock);
    expect((await db.outbox.get(e.id))!.tick).toBe('grey1');
    await syncOnce(db, deps);
    const sent = (await db.outbox.get(e.id))!;
    expect(sent).toMatchObject({ status: 'sent', tick: 'grey2', serverId: 'case-1' });
    server.open('case-1');
    await refreshTicks(db, deps);
    expect((await db.outbox.get(e.id))!.tick).toBe('blue2');
  });

  it('offline: nothing is lost, and sync backs off 1, 2, 4 … seconds up to 5 minutes', async () => {
    server.mode = 'down';
    const e = await enqueue(db, 'case.create', { programCode: 'SAAYA-WS' }, clock);
    await syncOnce(db, deps);
    let row = (await db.outbox.get(e.id))!;
    expect(row).toMatchObject({ status: 'saved', tick: 'grey1', attempts: 1 });
    expect(row.nextAttemptAt - clock).toBe(750); // 1 s step with jitter 0.5..1.0
    clock = row.nextAttemptAt;
    await syncOnce(db, deps);
    row = (await db.outbox.get(e.id))!;
    expect(row.nextAttemptAt - clock).toBe(1500);
    expect(backoffMs(30, () => 1)).toBe(300_000);
    server.mode = 'up';
    clock = row.nextAttemptAt;
    await syncOnce(db, deps);
    expect((await db.outbox.get(e.id))!.status).toBe('sent');
  });

  it('50 forced-drop replays create exactly one case (F2 acceptance)', async () => {
    const e = await enqueue(db, 'case.create', { programCode: 'SAAYA-WS' }, clock);
    server.mode = 'drop';
    for (let i = 0; i < 50; i++) {
      await syncOnce(db, deps);
      clock += 400_000;
    }
    server.mode = 'up';
    await syncOnce(db, deps);
    expect(server.cases).toBe(1);
    expect((await db.outbox.get(e.id))).toMatchObject({ status: 'sent', serverId: 'case-1' });
  });

  it('a 4xx marks the entry failed so the citizen is asked to redo it', async () => {
    server.mode = 'reject';
    const e = await enqueue(db, 'case.create', {}, clock);
    await syncOnce(db, deps);
    expect(await db.outbox.get(e.id)).toMatchObject({ status: 'failed', tick: 'failed', lastError: 'VALIDATION_FAILED' });
  });

  it('sends entries in order and stops at the first deferral', async () => {
    const a = await enqueue(db, 'case.create', { n: 1 }, clock);
    const b = await enqueue(db, 'case.create', { n: 2 }, clock + 1);
    server.mode = 'down';
    const r = await syncOnce(db, deps);
    expect(r).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect((await db.outbox.get(a.id))!.attempts).toBe(1);
    expect((await db.outbox.get(b.id))!.attempts).toBe(0);
  });
});
