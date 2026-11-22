import { z } from 'zod';

/** an empty value in .env ("OTP_PROVIDER=") means not set */
const blankIsUnset = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());

const schema = z.object({
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_DIRECT: z.string().optional(),
  AUTH_JWT_SECRET: z.string().min(32).optional(),
  PII_ENC_KEY: z.string().optional(),
  PII_HMAC_PEPPER: z.string().optional(),
  API_KEY_PEPPER: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  DEMO_MODE: z.string().optional(),
  /** when set, demo sign-in needs this code (judges get it privately); on Vercel, demo sign-in stays off without it */
  DEMO_ACCESS_CODE: z.string().optional(),
  /** where citizen sign-in codes go: mock (default, the on-screen phone only) or baileys (real numbers through the WhatsApp gateway) */
  OTP_PROVIDER: blankIsUnset(z.enum(['mock', 'baileys'])),
  WA_GATEWAY_URL: blankIsUnset(z.string().url()),
  WA_GATEWAY_SECRET: blankIsUnset(z.string().min(24)),
  DEMO_STAFF_PASSWORD: z.string().optional(),
  DEMO_CITIZEN_PIN: z.string().optional(),
  MOCK_BASE_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().optional(),
  NODE_ENV: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/** server-only: with OTP_PROVIDER=baileys the gateway URL and secret are required (checked on every read, so a bad setup fails at the first request) */
const checked = schema.superRefine((v, ctx) => {
  if (v.OTP_PROVIDER === 'baileys') {
    if (!v.WA_GATEWAY_URL) ctx.addIssue({ code: 'custom', path: ['WA_GATEWAY_URL'], message: 'required when OTP_PROVIDER=baileys' });
    if (!v.WA_GATEWAY_SECRET) ctx.addIssue({ code: 'custom', path: ['WA_GATEWAY_SECRET'], message: 'required (24+ characters) when OTP_PROVIDER=baileys' });
  }
});

/** Read on every call so tests can change process.env. */
export function env(): Env {
  return checked.parse(process.env) as Env;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

export const isDemoMode = () => env().DEMO_MODE === 'true';
export const demoAccessCode = () => env().DEMO_ACCESS_CODE?.trim() || null;
/**
 * Demo sign-in (the role picker and POST /api/v1/demo/tokens) is available when DEMO_MODE=true AND either an access code is
 * set or this is not a Vercel deployment (local runs and CI). A public deployment with DEMO_MODE=true but no code stays closed.
 */
export const demoSignInAvailable = () => isDemoMode() && (!!demoAccessCode() || !process.env.VERCEL);

export const otpProvider = () => env().OTP_PROVIDER ?? 'mock';
/** the gateway settings, or null when sign-in codes are not sent through WhatsApp */
export function waGateway(): { url: string; secret: string } | null {
  const e = env();
  return e.OTP_PROVIDER === 'baileys' && e.WA_GATEWAY_URL && e.WA_GATEWAY_SECRET ? { url: e.WA_GATEWAY_URL, secret: e.WA_GATEWAY_SECRET } : null;
}
