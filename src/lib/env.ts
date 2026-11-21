import { z } from 'zod';

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

/** Read on every call so tests can change process.env. */
export function env(): Env {
  return schema.parse(process.env);
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

export const isDemoMode = () => env().DEMO_MODE === 'true';
