import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { pushRegistryIcons, pushRegistryLogos } from '@handoff/cli/sync/push-registry-content';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushAssetsArgs extends SharedArgs {
  skipIcons?: boolean;
  skipLogos?: boolean;
}

const command: CommandModule<{}, PushAssetsArgs> = {
  command: 'push:assets',
  describe: 'Push asset catalogs to the connected registry: icons and logos. Faster than push:all when only assets have changed.',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('skip-icons', { type: 'boolean', default: false, describe: 'Skip /api/registry/icons push (icon catalog).' })
      .option('skip-logos', { type: 'boolean', default: false, describe: 'Skip /api/registry/logos push (logo set).' }),
  handler: async (args: PushAssetsArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();

    let failures = 0;
    const tryStep = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        failures++;
        const msg = e instanceof Error ? e.message : String(e);
        Logger.error(`push:assets step "${label}" failed: ${msg}`);
      }
    };

    if (!args.skipIcons) {
      await tryStep('icons', () => pushRegistryIcons(handoff));
    }

    if (!args.skipLogos) {
      await tryStep('logos', () => pushRegistryLogos(handoff));
    }

    if (failures > 0) {
      Logger.warn(`push:assets completed with ${failures} step failure(s) — see errors above.`);
      process.exit(1);
    } else {
      Logger.success('push:assets completed successfully.');
    }
  },
};

export default command;
