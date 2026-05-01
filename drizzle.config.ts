import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/app/lib/db/schema-pg.ts',
  out: './src/app/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/handoff',
  },
});
