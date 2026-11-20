import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // audit.ts is deliberately excluded: those tables are created verbatim from PRD §20.3
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  schemaFilter: ['public', 'mock'],
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '' },
  strict: true,
});
