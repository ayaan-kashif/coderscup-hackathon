/** pnpm db:migrate — applies src/db/migrations to DATABASE_URL_DIRECT (or DATABASE_URL). */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnvFiles } from './load-env';

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL_DIRECT (or DATABASE_URL)');
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {}, fetch_types: process.env.DB_FETCH_TYPES !== 'false' });
  const started = Date.now();
  await migrate(drizzle(client), { migrationsFolder: 'src/db/migrations' });
  const [row] = await client<{ n: number }[]>`select count(*)::int as n from pg_tables where schemaname in ('public','mock')`;
  console.log(`migrations applied in ${Date.now() - started} ms; ${row?.n} tables in public + mock`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
