import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPush } from '@handoff/cli/sync/run-push';
import {
  pushRegistryConfig,
  pushRegistryTheme,
  pushRegistryNavigation,
  pushRegistryPages,
  pushRegistryTokens,
  pushRegistryDtcg,
  pushRegistryIcons,
  pushRegistryLogos,
  pushRegistryFonts,
  pushFigmaImageFills,
  pushImageSlots,
} from '@handoff/cli/sync/push-registry-content';
import { refreshDesignMdIfPresent } from '@handoff/cli/fetch-design-md';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushAllArgs extends SharedArgs {
  skipBuild?: boolean;
  skipComponents?: boolean;
  skipPages?: boolean;
  skipConfig?: boolean;
  skipTheme?: boolean;
  skipNavigation?: boolean;
  skipTokens?: boolean;
  skipDtcg?: boolean;
  skipIcons?: boolean;
  skipLogos?: boolean;
  skipFonts?: boolean;
  skipFigmaFills?: boolean;
  skipImageSlots?: boolean;
  skipDesignMd?: boolean;
}

const command: CommandModule<{}, PushAllArgs> = {
  command: 'push:all',
  describe:
    'Push everything to the connected registry: components, pages, config, theme.css, navigation, tokens, DTCG dist, icons, logos. Use individual --skip-* flags to omit any piece.\n\n' +
    'Endpoints pushed:\n' +
    '| Endpoint                      | Payload                  | Source file              |\n' +
    '|-------------------------------|--------------------------|---------------------------|\n' +
    '| `POST /api/registry/config`   | project config JSON      | `config/config.json`     |\n' +
    '| `POST /api/registry/theme`    | compiled theme CSS       | `exported/theme.css`     |\n' +
    '| `POST /api/registry/navigation` | navigation tree JSON   | `config/navigation.json` |\n' +
    '| `POST /api/registry/tokens`   | Figma token snapshot     | `public/api/tokens.json` |\n' +
    '| `POST /api/registry/dtcg`     | DTCG dist output         | `design-system/dist/`    |\n' +
    '| `POST /api/registry/icons`    | icon catalog JSON        | `icons/catalog.json`     |\n' +
    '| `POST /api/registry/logos`    | logo set JSON            | `logos/logo-set.json`    |',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('skip-build', { type: 'boolean', default: false, describe: 'Skip local component build before push (use existing artifacts).' })
      .option('skip-components', { type: 'boolean', default: false, describe: 'Skip the components+pages push step.' })
      .option('skip-pages', { type: 'boolean', default: false, describe: 'Skip all page-related pushes: component doc pages (in the components step) and pages/ markdown content.' })
      .option('skip-config', { type: 'boolean', default: false, describe: 'Skip /api/registry/config push.' })
      .option('skip-theme', { type: 'boolean', default: false, describe: 'Skip /api/registry/theme push.' })
      .option('skip-navigation', { type: 'boolean', default: false, describe: 'Skip /api/registry/navigation push.' })
      .option('skip-tokens', { type: 'boolean', default: false, describe: 'Skip /api/registry/tokens push.' })
      .option('skip-dtcg', { type: 'boolean', default: false, describe: 'Skip /api/registry/dtcg push (DTCG token pipeline output).' })
      .option('skip-icons', { type: 'boolean', default: false, describe: 'Skip /api/registry/icons push (icon catalog).' })
      .option('skip-logos', { type: 'boolean', default: false, describe: 'Skip /api/registry/logos push (logo set).' })
      .option('skip-fonts', { type: 'boolean', default: false, describe: 'Skip /api/registry/fonts push (font files served at /fonts/<file>).' })
      .option('skip-figma-fills', { type: 'boolean', default: false, describe: 'Skip Figma image fills push (images fetched during `fetch` step).' })
      .option('skip-image-slots', { type: 'boolean', default: false, describe: 'Skip image slot sizing specs push (extracted from figmaImages in tokens snapshot).' })
      .option('skip-design-md', { type: 'boolean', default: false, describe: 'Skip refreshing DESIGN.md (only refreshed if the project already has one from `init-claude`).' }),
  handler: async (args: PushAllArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();

    let failures = 0;
    const tryStep = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        failures++;
        const msg = e instanceof Error ? e.message : String(e);
        Logger.error(`push:all step "${label}" failed: ${msg}`);
      }
    };

    // 1. Config — pushed first so subsequent steps can reference project metadata
    if (!args.skipConfig) {
      await tryStep('config', () => pushRegistryConfig(handoff));
    }

    // 2. Components + pages — the existing sync-event pipeline
    if (!args.skipComponents) {
      await tryStep('components+pages', () =>
        runPush(handoff, {
          // Skip pages here when --skip-pages is set; runPush handles both selectively
          pageSlugs: args.skipPages ? [] : undefined,
          noBuild: Boolean(args.skipBuild),
          // Skip components whose source files haven't changed since last push.
          // Bypassed when --force is set (handoff.force) or when a selective push is active.
          skipUnchanged: true,
        })
      );
    }

    // 3. Theme CSS
    if (!args.skipTheme) {
      await tryStep('theme', () => pushRegistryTheme(handoff));
    }

    // 4. Navigation
    if (!args.skipNavigation) {
      await tryStep('navigation', () => pushRegistryNavigation(handoff));
    }

    // 5. Pages content — markdown bodies pushed after nav so nav tree is already in place
    if (!args.skipPages) {
      await tryStep('pages', () => pushRegistryPages(handoff));
    }

    // 6. Tokens
    if (!args.skipTokens) {
      await tryStep('tokens', () => pushRegistryTokens(handoff));
    }

    // 7. DTCG token pipeline output (design-system/dist/)
    if (!args.skipDtcg) {
      await tryStep('dtcg', () => pushRegistryDtcg(handoff));
    }

    // 8. Icons
    if (!args.skipIcons) {
      await tryStep('icons', () => pushRegistryIcons(handoff));
    }

    // 9. Logos
    if (!args.skipLogos) {
      await tryStep('logos', () => pushRegistryLogos(handoff));
    }

    // 10. Fonts (served at /fonts/<file>; consumed by theme.css + foundation raster)
    if (!args.skipFonts) {
      await tryStep('fonts', () => pushRegistryFonts(handoff));
    }

    // 11. Figma image fills (downloaded during `fetch`, pushed to asset DAM)
    if (!args.skipFigmaFills) {
      await tryStep('figma-fills', () => pushFigmaImageFills(handoff));
    }

    // 12. Image slot sizing specs (extracted from figmaImages in tokens snapshot)
    if (!args.skipImageSlots) {
      await tryStep('image-slots', () => pushImageSlots(handoff));
    }

    // 13. Refresh DESIGN.md from the now-fresh registry (no-op unless the project
    //     opted in via `init-claude`). D2.
    if (!args.skipDesignMd) {
      await tryStep('design-md', () => refreshDesignMdIfPresent(handoff.workingPath));
    }

    if (failures > 0) {
      Logger.warn(`push:all completed with ${failures} step failure(s) — see errors above.`);
      process.exit(1);
    } else {
      Logger.success('push:all completed successfully.');
    }
  },
};

export default command;
