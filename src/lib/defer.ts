import { after } from 'next/server';
import { log } from './log';

/**
 * Run work after the HTTP response has been sent (Next.js `after`; on Vercel the function stays alive until it
 * finishes). Outside a request scope (tests, scripts) the work runs immediately in the background and can be
 * awaited with flushDeferred().
 */
const pending = new Set<Promise<void>>();

export function defer(fn: () => Promise<void>) {
  const wrapped = async () => { try { await fn(); } catch (e) { log('error', 'deferred work failed', { error: e instanceof Error ? e.stack ?? e.message : String(e) }); } };
  try {
    after(wrapped);
  } catch {
    const p = wrapped().finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** tests: wait for all background work started with defer() */
export async function flushDeferred() {
  while (pending.size) await Promise.all([...pending]);
}
