import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { pushRegistryTokens, pushRegistryDtcg } from '@handoff/cli/sync/push-registry-content';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushTokensArgs extends SharedArgs {
  skipFigma?: boolean;
  skipDtcg?: boolean;
}

const command: CommandModule<{}, PushTokensArgs> = {
  command: 'push:tokens',
  describe: 'Push token data to the connected registry: Figma token snapshot and DTCG dist. Faster than push:all when only tokens have changed.',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('skip-figma', { type: 'boolean', default: false, describe: 'Skip /api/registry/tokens push (Figma token snapshot).' })
      .option('skip-dtcg', { type: 'boolean', default: false, describe: 'Skip /api/registry/dtcg push (DTCG token pipeline output).' }),
  handler: async (args: PushTokensArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();

    let failures = 0;
    const tryStep = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        failures++;
        const msg = e instanceof Error ? e.message : String(e);
        Logger.error(`push:tokens step "${label}" failed: ${msg}`);
      }
    };

    if (!args.skipFigma) {
      await tryStep('figma-tokens', () => pushRegistryTokens(handoff));
    }

    if (!args.skipDtcg) {
      await tryStep('dtcg', () => pushRegistryDtcg(handoff));
    }

    if (failures > 0) {
      Logger.warn(`push:tokens completed with ${failures} step failure(s) — see errors above.`);
      process.exit(1);
    } else {
      Logger.success('push:tokens completed successfully.');
    }
  },
};

export default command;
