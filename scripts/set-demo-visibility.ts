/**
 * One-off: promote existing design artifacts + playground patterns to a shared visibility lane.
 *
 * Why this exists: Phase B (migration 0024) added `visibility` with a `private` default, so every
 * row that predates it is private. The Library's "Team" and "Public" lanes therefore look empty for
 * any non-admin user, which reads as a broken feature rather than the correct-by-default behavior
 * it actually is. (Admins bypass this — `designArtifactLaneClause` returns every row for them.)
 *
 * Deliberately NOT a migration. Migrations auto-run on boot for every registry deployment, and
 * flipping visibility is a per-tenant data decision, not a schema change — baking it into 0025
 * would silently expose private rows on SSC and every other tenant.
 *
 * Usage (dry run is the default — nothing is written unless you pass --apply):
 *   DATABASE_URL=<tenant db url> npx tsx scripts/set-demo-visibility.ts
 *   DATABASE_URL=<tenant db url> npx tsx scripts/set-demo-visibility.ts --apply
 *
 * Flags:
 *   --apply              actually write (otherwise report only)
 *   --visibility=team    target lane: team | public   (default: team)
 *   --owner=<userId>     only rows owned by this user (default: all rows)
 *   --include-patterns   also promote playground patterns (default: artifacts only)
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (name: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
};

const apply = has('--apply');
const includePatterns = has('--include-patterns');
const owner = valueOf('owner');
const visibility = (valueOf('visibility') ?? 'team').toLowerCase();

if (!['team', 'public'].includes(visibility)) {
  console.error(`--visibility must be "team" or "public" (got "${visibility}")`);
  process.exit(1);
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const usePooler = /-pooler\.|pooler\.|neon\.tech/i.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(usePooler ? { prepare: false } : {}),
});

/** Redact credentials before echoing the target back to the operator. */
function safeTarget(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`;
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

async function promote(table: string, label: string): Promise<void> {
  const scope = owner ? client`AND "user_id" = ${owner}` : client``;

  const [{ count: pending }] = await client<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM ${client(table)}
    WHERE "visibility" = 'private' ${scope}
  `;

  if (Number(pending) === 0) {
    console.log(`  ${label}: nothing to promote`);
    return;
  }

  if (!apply) {
    console.log(`  ${label}: ${pending} private row(s) would become "${visibility}"`);
    return;
  }

  const updated = await client`
    UPDATE ${client(table)}
    SET "visibility" = ${visibility}
    WHERE "visibility" = 'private' ${scope}
    RETURNING "id"
  `;
  console.log(`  ${label}: promoted ${updated.length} row(s) to "${visibility}"`);
}

async function main(): Promise<void> {
  console.log(`Target   : ${safeTarget(url!)}`);
  console.log(`Mode     : ${apply ? 'APPLY (writing)' : 'dry run (no writes)'}`);
  console.log(`Lane     : ${visibility}`);
  console.log(`Owner    : ${owner ?? 'all rows'}`);
  console.log('');

  await promote('handoff_design_artifact', 'design artifacts');
  if (includePatterns) {
    await promote('handoff_pattern', 'playground patterns');
  } else {
    console.log('  playground patterns: skipped (pass --include-patterns to include)');
  }

  if (!apply) {
    console.log('\nDry run only — re-run with --apply to write.');
  }
}

main()
  .catch((err) => {
    console.error('[set-demo-visibility]', err);
    process.exitCode = 1;
  })
  .finally(() => client.end({ timeout: 5 }));
