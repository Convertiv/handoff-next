import { CommandModule } from 'yargs';
import fs from 'fs-extra';
import path from 'path';
import { Logger } from '@handoff/utils/logger';

export interface InitVercelArgs {
  root?: string;
}

const VERCEL_JSON = {
  buildCommand: 'handoff-app vercel-build',
  outputDirectory: '.handoff/runtime/.next',
  installCommand: 'npm install',
  framework: 'nextjs',
};

const ENV_EXAMPLE = `# Handoff registry — copy to .env and fill in values.
# Required for registry (Postgres) mode.

# --- Database ---
# Vercel Postgres automatically sets this. For local dev, use your connection string.
DATABASE_URL=postgresql://user:pass@localhost:5432/handoff

# --- Auth ---
# Generate with: openssl rand -hex 32
AUTH_SECRET=

# --- CLI / MCP sync ---
# Any strong random string. CLI push/pull and MCP clients use this as a bearer token.
# Generate with: openssl rand -hex 32
HANDOFF_SYNC_SECRET=

# --- Optional ---
# HANDOFF_DEFAULT_STACK_PROFILE=bootstrap-handlebars
# HANDOFF_PROJECT_NAME=my-design-system
`;

const NEXT_STEPS = `
  Next steps for Vercel deployment:
  ────────────────────────────────────────────────────────
  1. Push this project to GitHub / GitLab / Bitbucket.

  2. In the Vercel dashboard:
     • Import the repository.
     • Set Root Directory to the folder containing vercel.json
       (e.g. "handoff" if your design system lives in a subdirectory).
     • Framework Preset: Next.js
     • Build Command:    handoff-app vercel-build       (auto-read from vercel.json)
     • Output Directory: .handoff/runtime/.next         (auto-read from vercel.json)

  3. Add Vercel Postgres:
     Storage → Create Database → Postgres
     Vercel auto-sets DATABASE_URL in your project environment.

  4. Add the remaining environment variables (Project → Settings → Environment Variables):
     AUTH_SECRET        (required — generate with: openssl rand -hex 32)
     HANDOFF_SYNC_SECRET (required — any strong random string)

  5. Deploy. On first visit the app will:
     • Auto-run database migrations  (no CLI step needed)
     • Redirect to /setup            (create your admin account)

  6. Configure your workspace for push/pull:
     In your project's .env (NOT .env.local):
       HANDOFF_CLOUD_URL=https://your-registry.vercel.app
       HANDOFF_CLOUD_TOKEN=<same value as HANDOFF_SYNC_SECRET>

  See docs/REGISTRY-SETUP.md for the full guide.
`;

const command: CommandModule<{}, InitVercelArgs> = {
  command: 'init:vercel',
  describe: 'Write vercel.json and .env.vercel.example for deploying this project as a Handoff registry',
  builder: (yargs) =>
    yargs.option('root', {
      type: 'string',
      describe: 'Directory to write files to (default: current directory)',
    }),
  handler: async (args: InitVercelArgs) => {
    const dir = path.resolve(args.root ?? process.cwd());
    await fs.ensureDir(dir);

    const vercelJsonPath = path.join(dir, 'vercel.json');
    const envExamplePath = path.join(dir, '.env.vercel.example');

    let wroteSomething = false;

    if (await fs.pathExists(vercelJsonPath)) {
      Logger.warn(`vercel.json already exists at ${vercelJsonPath} — skipping (delete it first to regenerate).`);
    } else {
      await fs.writeJson(vercelJsonPath, VERCEL_JSON, { spaces: 2 });
      Logger.success(`Created ${vercelJsonPath}`);
      wroteSomething = true;
    }

    if (await fs.pathExists(envExamplePath)) {
      Logger.warn(`.env.vercel.example already exists at ${envExamplePath} — skipping.`);
    } else {
      await fs.writeFile(envExamplePath, ENV_EXAMPLE, 'utf-8');
      Logger.success(`Created ${envExamplePath}`);
      wroteSomething = true;
    }

    if (wroteSomething) {
      Logger.log(NEXT_STEPS);
    } else {
      Logger.log('Nothing written — both files already exist.');
    }
  },
};

export default command;
