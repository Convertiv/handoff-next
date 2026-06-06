import { Argv, CommandModule } from 'yargs';
import { runNextProductionBuild } from '@handoff/app-builder/index';
import { getEphemeralRuntimePath } from '@handoff/app-builder/paths';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface VercelBuildArgs extends SharedArgs {
  skipComponents?: boolean;
}

const command: CommandModule<{}, VercelBuildArgs> = {
  command: 'vercel-build',
  describe:
    'Run `build:app --mode vercel` then `next build` in `.handoff/runtime` (single command for Vercel; preserves full Handoff pipeline)',
  builder: (yargs): Argv<VercelBuildArgs> =>
    getSharedOptions(yargs).option('skip-components', {
      describe: 'Skip building components before preparing the runtime',
      type: 'boolean',
      default: false,
    }) as Argv<VercelBuildArgs>,
  handler: async (args: VercelBuildArgs) => {
    const handoff = new Handoff(args.debug, args.force);

    // Diagnostic: report which env vars are visible at build start (keys only,
    // no values). Helps debug Vercel deploys where env vars may be scoped to
    // runtime-only, marked sensitive, or simply missing.
    const interesting = [
      'DATABASE_URL',
      'POSTGRES_URL',
      'POSTGRES_PRISMA_URL',
      'POSTGRES_URL_NON_POOLING',
      'AUTH_SECRET',
      'AUTH_URL',
      'NEXTAUTH_URL',
      'NEXTAUTH_SECRET',
      'AUTH_TRUST_HOST',
      'HANDOFF_SYNC_SECRET',
      'HANDOFF_CLOUD_URL',
      'HANDOFF_REGISTRY_MODE',
      'HANDOFF_DEFAULT_STACK_PROFILE',
      'VERCEL',
      'VERCEL_URL',
      'VERCEL_ENV',
      'NEXT_PHASE',
      'NODE_ENV',
    ];
    console.log('[handoff] Build-time env var diagnostic:');
    for (const key of interesting) {
      const raw = process.env[key];
      if (raw === undefined) {
        console.log(`  ${key}: NOT SET`);
      } else {
        const trimmed = raw.trim();
        const ws = raw.length !== trimmed.length ? ' (has whitespace!)' : '';
        console.log(`  ${key}: SET (length=${trimmed.length})${ws}`);
      }
    }

    // Registry mode: components are built locally in workspaces and pushed —
    // rebuilding them during CI is wasteful. Three ways to enable auto-skip:
    //   1. --skip-components flag (explicit, most reliable)
    //   2. HANDOFF_REGISTRY_MODE=true env var (non-secret, reliable at Vercel build time)
    //   3. DATABASE_URL present at build time (may not be exposed to build env on Vercel)
    const isRegistryMode =
      Boolean(process.env.HANDOFF_REGISTRY_MODE?.trim()) ||
      Boolean(process.env.DATABASE_URL?.trim());
    const skipComponents = args.skipComponents ?? isRegistryMode;

    if (skipComponents) {
      const reason = args.skipComponents
        ? '--skip-components flag'
        : process.env.HANDOFF_REGISTRY_MODE
          ? 'HANDOFF_REGISTRY_MODE env var'
          : 'DATABASE_URL detected';
      console.log(`[handoff] Skipping component builds (${reason}). Use --no-skip-components to override.`);
    }

    await handoff.build(skipComponents, 'vercel');
    const appPath = getEphemeralRuntimePath(handoff);
    runNextProductionBuild(handoff, appPath);
  },
};

export default command;
