import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/all';

export type Schema = typeof schema;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, Schema, any>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

let current: Db | undefined;

/** The app's database. Production: Supabase Postgres over the pooled URL. Tests inject PGlite with setDb(). */
export function getDb(): Db {
  if (current) return current;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // transaction-mode pooler (port 6543) does not support prepared statements
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
  current = drizzle(client, { schema }) as unknown as Db;
  return current;
}

export function setDb(db: Db | undefined) {
  current = db;
}

export { schema };
