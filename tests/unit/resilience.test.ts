import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError, TimeoutError, TransientError, withRetry, withTimeout } from '@/services/adapters/resilience';

describe('circuit breaker (§27.2: open after 5 failures in 30 s, half-open after 30 s)', () => {
  it('opens, half-opens with a single trial, and closes on success', () => {
    let now = 0;
    const b = new CircuitBreaker('identity', undefined, { now: () => now });
    for (let i = 0; i < 4; i++) { b.before(); b.failure(); }
    expect(b.state).toBe('closed');
    b.before(); b.failure();
    expect(b.state).toBe('open');
    expect(() => b.before()).toThrow(CircuitOpenError);
    now += 30_000;
    expect(b.state).toBe('half_open');
    b.before();
    expect(() => b.before()).toThrow(CircuitOpenError); // only one trial at a time
    b.success();
    expect(b.state).toBe('closed');
  });

  it('failures older than the window do not count', () => {
    let now = 0;
    const b = new CircuitBreaker('civil', undefined, { now: () => now });
    for (let i = 0; i < 4; i++) b.failure();
    now += 31_000;
    b.failure();
    expect(b.state).toBe('closed');
  });

  it('a failed half-open trial re-opens the circuit', () => {
    let now = 0;
    const b = new CircuitBreaker('ledger', undefined, { now: () => now });
    for (let i = 0; i < 5; i++) b.failure();
    now += 30_000;
    b.before(); b.failure();
    expect(b.state).toBe('open');
  });
});

describe('retries and timeouts', () => {
  it('retries transient errors with capped full-jitter backoff', async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(async () => { calls++; if (calls < 3) throw new TransientError('503'); return 'ok'; },
      { retries: 3, baseMs: 100, maxMs: 1000, sleep: async (ms) => { waits.push(ms); }, random: () => 0.999 });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([99, 199]);
  });

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error('400'); }, { retries: 3, baseMs: 1, maxMs: 1, sleep: async () => {} })).rejects.toThrow('400');
    expect(calls).toBe(1);
  });

  it('times out and aborts the call', async () => {
    let aborted = false;
    await expect(withTimeout(20, (signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }); })))
      .rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });
});
