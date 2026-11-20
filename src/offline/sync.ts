/**
 * The sync engine (PRD §22.4, OFF-3, OFF-4). Sends outbox entries in order with Idempotency-Key = entry id.
 *   2xx → sent (two grey ticks) · 4xx → failed, the item must be redone · network error or 5xx → back off
 *   1, 2, 4, 8 … seconds up to 5 minutes, with jitter.
 * Runs on reconnect, on app open and every 30 seconds while online. Time, randomness and fetch are injected.
 */
import type { OutboxDb, OutboxEntry, Tick } from './outbox';

export const BACKOFF_CAP_MS = 5 * 60_000;
export const SYNC_INTERVAL_MS = 30_000;

export function backoffMs(attempts: number, random: () => number) {
  const base = Math.min(BACKOFF_CAP_MS, 1000 * 2 ** Math.max(0, attempts - 1));
  // jitter: between 50% and 100% of the step, so many phones do not retry in lockstep
  return Math.round(base * (0.5 + random() * 0.5));
}

export type SyncDeps = {
  fetch: typeof fetch;
  now: () => number;
  random: () => number;
  /** called after each state change, e.g. to play "saved" or "reached the office" */
  onChange?: (e: OutboxEntry) => void;
};

const ROUTES: Record<OutboxEntry['type'], { method: string; path: string }> = {
  'case.create': { method: 'POST', path: '/api/v1/cases' },
};

let running = false;

/** One pass over due entries, oldest first. Returns how many were acknowledged. */
export async function syncOnce(db: OutboxDb, deps: SyncDeps): Promise<{ sent: number; failed: number; deferred: number }> {
  if (running) return { sent: 0, failed: 0, deferred: 0 };
  running = true;
  const res = { sent: 0, failed: 0, deferred: 0 };
  try {
    const due = (await db.outbox.where('status').anyOf('saved', 'sending').sortBy('createdAt')).filter((e) => e.nextAttemptAt <= deps.now());
    for (const e of due) {
      const route = ROUTES[e.type];
      await db.outbox.update(e.id, { status: 'sending', attempts: e.attempts + 1 });
      let status = 0;
      let body: Record<string, unknown> | null = null;
      try {
        const r = await deps.fetch(route.path, {
          method: route.method,
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': e.id },
          body: JSON.stringify({ ...e.payload, clientSubmissionId: e.payload.clientSubmissionId ?? e.id }),
        });
        status = r.status;
        body = await r.json().catch(() => null);
      } catch (err) {
        status = 0;
        body = { detail: err instanceof Error ? err.message : 'network error' };
      }
      let patch: Partial<OutboxEntry>;
      if (status >= 200 && status < 300) {
        patch = { status: 'sent', tick: 'grey2', serverId: String(body?.id ?? ''), serverStatus: status, lastError: undefined };
        res.sent++;
      } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        patch = { status: 'failed', tick: 'failed', serverStatus: status, lastError: String(body?.code ?? status) };
        res.failed++;
      } else {
        // network error, timeout, 429 or 5xx: keep it on the phone and retry later
        patch = { status: 'saved', tick: 'grey1', nextAttemptAt: deps.now() + backoffMs(e.attempts + 1, deps.random), lastError: String(body?.code ?? body?.detail ?? status) };
        res.deferred++;
      }
      await db.outbox.update(e.id, patch);
      const updated = await db.outbox.get(e.id);
      if (updated) deps.onChange?.(updated);
      // stop on the first deferral: entries are sent in order
      if (patch.status === 'saved') break;
    }
  } finally {
    running = false;
  }
  return res;
}

/** Refresh ticks for acknowledged cases: two blue once an officer has opened the case (OQ-5). */
export async function refreshTicks(db: OutboxDb, deps: SyncDeps) {
  const sent = await db.outbox.where('status').equals('sent').toArray();
  for (const e of sent) {
    if (!e.serverId || e.tick === 'blue2') continue;
    try {
      const r = await deps.fetch(`/api/v1/cases/${e.serverId}/status`, { credentials: 'same-origin' });
      if (!r.ok) continue;
      const b = (await r.json()) as { ticks?: string };
      const tick: Tick = b.ticks === 'blue2' ? 'blue2' : 'grey2';
      if (tick !== e.tick) {
        await db.outbox.update(e.id, { tick });
        deps.onChange?.({ ...e, tick });
      }
    } catch { /* offline: try again on the next pass */ }
  }
}

/** Wires the triggers: app open, the online event, and every 30 s while online. Returns a stop function. */
export function startSync(db: OutboxDb, deps: SyncDeps) {
  const run = () => { if (typeof navigator === 'undefined' || navigator.onLine) void syncOnce(db, deps).then(() => refreshTicks(db, deps)); };
  run();
  const timer = setInterval(run, SYNC_INTERVAL_MS);
  window.addEventListener('online', run);
  return () => { clearInterval(timer); window.removeEventListener('online', run); };
}
