import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { setDb, type Db } from '@/db/client';
import * as schema from '@/db/schema/all';

export type TestDb = { db: Db; pg: PGlite; close: () => Promise<void> };

/** A fresh in-process Postgres 17 with every migration applied, exactly as production runs them. */
export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create({ extensions: { vector, pgcrypto, pg_trgm } });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: path.resolve(__dirname, '../../src/db/migrations') });
  setDb(db);
  return { db, pg, close: async () => { setDb(undefined); await pg.close(); } };
}
