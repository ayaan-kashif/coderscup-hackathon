/**
 * pnpm db:seed      — idempotent seed of tenants, demo accounts, generated mock data, rule sets, policy, models
 * pnpm demo:reset   — truncates everything first (PRD §18.3), then seeds
 *
 * Needs DEMO_STAFF_PASSWORD (10+ chars) and DEMO_CITIZEN_PIN (4 digits) in the environment: no credential is in the repo.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { hashSecret } from '@/auth/crypto';
import { setDb, type Db } from '@/db/client';
import * as schema from '@/db/schema/all';
import { seedCore } from '@/services/seed/core';
import { seedGenerated } from '@/services/seed/generated';
import { seedDemoCases } from '@/services/seed/demo-cases';
import { loadEnvFiles } from './load-env';

async function main() {
  loadEnvFiles();
  const reset = process.argv.includes('--reset');
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  const staffPassword = process.env.DEMO_STAFF_PASSWORD;
  const citizenPin = process.env.DEMO_CITIZEN_PIN;
  if (!url) throw new Error('Set DATABASE_URL_DIRECT or DATABASE_URL');
  if (!staffPassword || !citizenPin) throw new Error('Set DEMO_STAFF_PASSWORD and DEMO_CITIZEN_PIN (see .env.example)');
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {}, fetch_types: process.env.DB_FETCH_TYPES !== 'false' });
  const db = drizzle(client, { schema, logger: process.env.SQL_LOG === '1' }) as unknown as Db;
  const started = Date.now();
  const ids = await db.transaction(async (tx) => {
    const ids = await seedCore(tx, { staffPassword, citizenPin, reset });
    const counts = await seedGenerated(tx, ids, { citizenPinHash: await hashSecret(citizenPin) });
    console.log('generated data:', counts);
    return ids;
  });
  // demo fixtures run through the real pipeline (mocks in-process on this same connection)
  setDb(db);
  console.log('demo cases:', JSON.stringify(await seedDemoCases(db, ids)));
  console.log(`${reset ? 'demo reset' : 'seed'} done in ${((Date.now() - started) / 1000).toFixed(1)} s; tenants: ${Object.keys(ids.tenantIds).join(', ')}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
