/**
 * pnpm eval — the offline evaluation (PRD §25.2) on the frozen datasets: writes data/models/eval-report.json and an
 * eval_runs row, which the dashboard shows with its date. Needs DATABASE_URL (retrieval runs on the policy table).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { setDb, type Db } from '@/db/client';
import * as schema from '@/db/schema/all';
import { runOfflineEval } from '@/services/evaluation';
import { loadEnvFiles } from './load-env';

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL');
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {}, fetch_types: process.env.DB_FETCH_TYPES !== 'false' });
  const db = drizzle(client, { schema }) as unknown as Db;
  setDb(db);
  const r = await runOfflineEval(db);
  console.log(JSON.stringify({ routing: r.routing, scam: r.scam, documents: { caught: r.documents.editedAndForgedCaught, cleanFlagged: r.documents.cleanFlagged }, rag: r.rag.retrievalHitAt4 }, null, 1));
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
