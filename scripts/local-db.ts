/**
 * pnpm db:local — a local Postgres 17 (PGlite over the wire protocol) for running the app with no Docker and no
 * cloud account. Data lives in ./.pglite (gitignored). Point DATABASE_URL at it and set DB_POOL_MAX=1:
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
 * PGlite is a single session, so the app must use one connection (transactions would interleave otherwise).
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

async function main() {
  const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
  const db = await PGlite.create('./.pglite', { extensions: { vector, pgcrypto, pg_trgm } });
  // Next.js renders pages and route handlers in separate module graphs, each with its own pool, so allow a few
  // connections. PGlite queues them at query level on ONE session: fine for local smoke tests, never for production.
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
  await server.start();
  console.log(`local Postgres (PGlite) on postgres://postgres:postgres@127.0.0.1:${port}/postgres — Ctrl+C to stop`);
  const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
