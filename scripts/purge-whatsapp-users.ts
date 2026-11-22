/**
 * pnpm users:purge-whatsapp          counts the accounts created with a real number (nothing is deleted)
 * pnpm users:purge-whatsapp --yes    deletes every one of them and all their data (cases, documents, consents, profile, login)
 * For use after the event. The seeded fictional accounts (+92 00000) are never touched. Prints counts only.
 */
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema/all';
import { users } from '@/db/schema/all';
import { purgeWhatsappAccounts } from '@/services/account';
import { loadEnvFiles } from './load-env';

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL_DIRECT or DATABASE_URL');
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {}, fetch_types: process.env.DB_FETCH_TYPES !== 'false' });
  const db = drizzle(client, { schema }) as unknown as Db;
  const where = and(eq(users.kind, 'citizen'), isNotNull(users.phoneHash));
  const [{ n }] = (await db.select({ n: count() }).from(users).where(where)) as [{ n: number }];
  if (!process.argv.includes('--yes')) {
    console.log(`${n} account(s) were created with a real number. Run "pnpm users:purge-whatsapp --yes" to delete them and all their data.`);
  } else {
    const deleted = await db.transaction((tx) => purgeWhatsappAccounts(tx));
    console.log(`Deleted ${deleted} account(s) created with a real number, with all their data.`);
  }
  await client.end();
}

main().catch((e) => { console.error(e instanceof Error ? e.message.split('\n')[0] : 'failed'); process.exit(1); });
