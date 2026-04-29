/**
 * Seed Postgres from static `public/api` JSON (run with HANDOFF_MODE=dynamic + DATABASE_URL).
 *
 * Usage: `HANDOFF_MODE=dynamic DATABASE_URL=... npx tsx src/app/lib/db/seed.ts`
 */
import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { getPublicApiDir } from '../data/static-provider';
import { count } from 'drizzle-orm';
import { hashPassword } from '../passwords';
import { getDb } from './index';
import { handoffComponents, handoffPatterns, handoffTokensSnapshots, users } from './schema';

async function seedBootstrapAdmin(db: NonNullable<ReturnType<typeof getDb>>) {
  const email = process.env.HANDOFF_ADMIN_EMAIL?.trim().toLowerCase();
  const plain = process.env.HANDOFF_ADMIN_PASSWORD;
  if (!email || !plain) return;
  const [{ n }] = await db.select({ n: count() }).from(users);
  if ((n ?? 0) > 0) return;
  const passwordHash = await hashPassword(plain);
  await db.insert(users).values({
    email,
    name: email.split('@')[0] || 'Admin',
    role: 'admin',
    passwordHash,
  });
  console.log('Bootstrap admin user created:', email);
}

function resolveApiDir(): string {
  const fromEnv = getPublicApiDir();
  if (fs.existsSync(fromEnv)) return fromEnv;
  return path.join(process.cwd(), 'public', 'api');
}

async function main() {
  process.env.HANDOFF_MODE = process.env.HANDOFF_MODE || 'dynamic';
  const db = getDb();
  if (!db) {
    console.error('Set HANDOFF_MODE=dynamic and DATABASE_URL');
    process.exit(1);
  }

  await seedBootstrapAdmin(db);

  const apiDir = resolveApiDir();
  if (!(await fs.pathExists(apiDir))) {
    console.warn('No public API dir at', apiDir, '- nothing to seed');
    return;
  }

  const componentsPath = path.join(apiDir, 'components.json');
  if (await fs.pathExists(componentsPath)) {
    const list = JSON.parse(await fs.readFile(componentsPath, 'utf-8')) as Array<Record<string, unknown>>;
    await db.delete(handoffComponents);
    if (list.length > 0) {
      await db.insert(handoffComponents).values(
        list.map((row) => {
          const id = String(row.id ?? '');
          return {
            id,
            path: String(row.path ?? ''),
            title: String(row.title ?? id),
            description: (row.description as string) ?? '',
            group: (row.group as string) ?? '',
            image: (row.image as string) ?? '',
            type: (row.type as string) ?? 'element',
            properties: (row.properties as object) ?? {},
            previews: (row.previews as object) ?? {},
            data: row as object,
            source: 'disk' as const,
          };
        })
      );
    }
    console.log('Seeded components:', list.length);
  }

  const patternsPath = path.join(apiDir, 'patterns.json');
  if (await fs.pathExists(patternsPath)) {
    const plist = JSON.parse(await fs.readFile(patternsPath, 'utf-8')) as Array<Record<string, unknown>>;
    await db.delete(handoffPatterns);
    if (plist.length > 0) {
      await db.insert(handoffPatterns).values(
        plist.map((row) => {
          const id = String(row.id ?? '');
          return {
            id,
            path: String(row.path ?? ''),
            title: String(row.title ?? id),
            description: (row.description as string) ?? '',
            group: (row.group as string) ?? '',
            tags: (row.tags as object) ?? [],
            components: (row.components as object) ?? [],
            data: row as object,
            source: 'build',
            userId: null,
            thumbnail: null,
          };
        })
      );
    }
    console.log('Seeded patterns:', plist.length);
  }

  const tokensPath = process.env.HANDOFF_EXPORT_PATH
    ? path.resolve(process.env.HANDOFF_EXPORT_PATH, 'tokens.json')
    : path.resolve(process.cwd(), process.env.HANDOFF_OUTPUT_DIR ?? 'exported', 'tokens.json');
  if (await fs.pathExists(tokensPath)) {
    const payload = JSON.parse(await fs.readFile(tokensPath, 'utf-8'));
    await db.insert(handoffTokensSnapshots).values({ payload });
    console.log('Seeded tokens snapshot from', tokensPath);
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
