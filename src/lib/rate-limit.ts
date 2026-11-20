import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { log } from './log';

export type LimitRule = { name: string; key: string; limit: number; windowSec: number; failClosed?: boolean };
export type LimitResult = { success: boolean; limit: number; remaining: number; reset: number };

interface Backend { check(rule: LimitRule, nowMs: number): Promise<LimitResult> }

/** Sliding log in memory: used locally, in tests, and when Upstash is not configured. Per instance only. */
class MemoryBackend implements Backend {
  private hits = new Map<string, number[]>();
  async check(rule: LimitRule, nowMs: number): Promise<LimitResult> {
    const k = `${rule.name}:${rule.key}`;
    const from = nowMs - rule.windowSec * 1000;
    const list = (this.hits.get(k) ?? []).filter((t) => t > from);
    const success = list.length < rule.limit;
    if (success) list.push(nowMs);
    this.hits.set(k, list);
    const reset = list.length ? list[0]! + rule.windowSec * 1000 : nowMs + rule.windowSec * 1000;
    return { success, limit: rule.limit, remaining: Math.max(0, rule.limit - list.length), reset };
  }
  clear() { this.hits.clear(); }
}

class UpstashBackend implements Backend {
  private limiters = new Map<string, Ratelimit>();
  constructor(private redis: Redis) {}
  async check(rule: LimitRule): Promise<LimitResult> {
    const id = `${rule.name}:${rule.limit}:${rule.windowSec}`;
    let rl = this.limiters.get(id);
    if (!rl) {
      rl = new Ratelimit({ redis: this.redis, limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSec} s`), prefix: `amanat:rl:${rule.name}` });
      this.limiters.set(id, rl);
    }
    const r = await rl.limit(rule.key);
    return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
  }
}

const memory = new MemoryBackend();
let backend: Backend | undefined;

function getBackend(): Backend {
  if (backend) return backend;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  backend = url && token ? new UpstashBackend(new Redis({ url, token })) : memory;
  return backend;
}

export const rateLimitBackendName = () => (getBackend() === memory ? 'memory' : 'upstash');
export const resetMemoryRateLimits = () => memory.clear();

/**
 * Checks every rule; the tightest result is reported in RateLimit-* headers.
 * If Redis itself fails: fail open for normal traffic, closed for OTP (PRD §21.6).
 */
export async function checkLimits(rules: LimitRule[], nowMs = Date.now()): Promise<{ ok: boolean; tightest: LimitResult | null; failed?: LimitRule }> {
  let tightest: LimitResult | null = null;
  for (const rule of rules) {
    let r: LimitResult;
    try {
      r = await getBackend().check(rule, nowMs);
    } catch (e) {
      log('warn', 'rate limiter unavailable', { rule: rule.name, error: String(e) });
      if (rule.failClosed) return { ok: false, tightest: { success: false, limit: rule.limit, remaining: 0, reset: nowMs + 60_000 }, failed: rule };
      continue;
    }
    if (!tightest || r.remaining < tightest.remaining) tightest = r;
    if (!r.success) return { ok: false, tightest: r, failed: rule };
  }
  return { ok: true, tightest };
}
