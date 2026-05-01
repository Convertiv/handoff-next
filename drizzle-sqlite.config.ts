import { defineConfig } from 'drizzle-kit';

/** Generate SQLite migrations from `schema-sqlite.ts` (optional; bootstrap still applies DDL on boot). */
export default defineConfig({
  schema: './src/app/lib/db/schema-sqlite.ts',
  out: './src/app/lib/db/migrations-sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'file:.handoff/drizzle-sqlite-stub.db',
  },
});
