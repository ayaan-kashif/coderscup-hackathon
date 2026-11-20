/** PRD §27.2: timeouts, retries with exponential backoff and jitter, and a circuit breaker per mock service. */

export type Clock = { now: () => number };
export const realClock: Clock = { now: () => Date.now() };

export class TimeoutError extends Error {
  constructor(public readonly ms: number) { super(`timed out after ${ms} ms`); this.name = 'TimeoutError'; }
}
export class CircuitOpenError extends Error {
  constructor(public readonly service: string) { super(`circuit open for ${service}`); this.name = 'CircuitOpenError'; }
}
/** An error worth retrying (network, timeout, 5xx). 4xx answers are not retried. */
export class TransientError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'TransientError'; }
}

type State = 'closed' | 'open' | 'half_open';

/** Opens after `threshold` failures within `windowMs`; after `openMs` lets one trial call through (half-open). */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private trialInFlight = false;
  constructor(readonly service: string, private opts = { threshold: 5, windowMs: 30_000, openMs: 30_000 }, private clock: Clock = realClock) {}

  get state(): State {
    if (this.openedAt === null) return 'closed';
    return this.clock.now() - this.openedAt >= this.opts.openMs ? 'half_open' : 'open';
  }

  /** throws CircuitOpenError when calls must not go out */
  before() {
    const s = this.state;
    if (s === 'open') throw new CircuitOpenError(this.service);
    if (s === 'half_open') {
      if (this.trialInFlight) throw new CircuitOpenError(this.service);
      this.trialInFlight = true;
    }
  }

  success() {
    this.failures = [];
    this.openedAt = null;
    this.trialInFlight = false;
  }

  failure() {
    const now = this.clock.now();
    if (this.state === 'half_open') {
      this.openedAt = now;
      this.trialInFlight = false;
      return;
    }
    this.failures = this.failures.filter((t) => now - t < this.opts.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.opts.threshold) this.openedAt = now;
  }

  snapshot() {
    return { service: this.service, state: this.state, recentFailures: this.failures.length };
  }
}

export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const e = new TimeoutError(ms); ctl.abort(e); reject(e); }, ms);
  });
  try {
    return await Promise.race([fn(ctl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type RetryOpts = {
  retries: number;
  baseMs: number;
  maxMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/** Full-jitter exponential backoff. Only call this for idempotent operations. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  let last: unknown;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      const retryable = e instanceof TimeoutError || e instanceof TransientError;
      if (!retryable || attempt === o.retries) throw e;
      const cap = Math.min(o.maxMs, o.baseMs * 2 ** attempt);
      await sleep(Math.floor(random() * cap));
    }
  }
  throw last;
}
