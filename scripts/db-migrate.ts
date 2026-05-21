/**
 * Apply Drizzle SQL migrations using drizzle-orm (avoids drizzle-kit hoisting issues in npm workspaces).
 *
 * Usage: DATABASE_URL=postgresql://... npm run db:migrate
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const migrationsFolder = path.join(repoRoot, 'src/app/lib/db/migrations');

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is required (e.g. postgresql://user:pass@localhost:5432/handoff)');
  process.exit(1);
}

const client = postgres(url, { max: 1 });

try {
  const db = drizzle(client);
  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied successfully.');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
