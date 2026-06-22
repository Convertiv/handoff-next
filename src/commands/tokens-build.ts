import path from 'path';
import fs from 'fs-extra';
import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { migrateLegacyTokens } from '@handoff/cli/tokens/migrate-legacy';
import { transformTokens } from '@handoff/cli/tokens/transform';
import { ensureDefaultBrand } from '@handoff/cli/tokens/ensure-default-brand';
import { parseCssBrands } from '@handoff/cli/tokens/parse-css-brands';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface TokensBuildArgs extends SharedArgs {
  skipMigrate?: boolean;
}

async function needsMigration(workingPath: string): Promise<boolean> {
  const tokensDir = path.join(workingPath, 'design-system', 'tokens');
  if (!(await fs.pathExists(tokensDir))) return true;

  function hasTokenFiles(dir: string): boolean {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && hasTokenFiles(full)) return true;
      if (entry.name.endsWith('.tokens.json')) return true;
    }
    return false;
  }

  return !hasTokenFiles(tokensDir);
}

const command: CommandModule<{}, TokensBuildArgs> = {
  command: 'tokens:build',
  describe: 'Build DTCG token outputs from design-system/tokens/. Auto-migrates a legacy Figma export on first run.',
  builder: (yargs) =>
    getSharedOptions(yargs).option('skip-migrate', {
      type: 'boolean',
      default: false,
      describe: 'Skip the auto-migration step even if design-system/tokens/ is empty.',
    }),
  handler: async (args: TokensBuildArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    const workingPath = handoff.workingPath;

    // ── Step 1: Auto-migrate legacy tokens if needed ─────────────────────
    if (!args.skipMigrate && (await needsMigration(workingPath))) {
      const tokensPath = handoff.getTokensFilePath();
      if (await fs.pathExists(tokensPath)) {
        Logger.info(`Detected legacy token export — migrating to design-system/tokens/ (DTCG format)...`);
        await migrateLegacyTokens(handoff);
        Logger.success('Migration complete. You can safely remove the exported/ directory from git after verifying the output.');
      } else {
        Logger.warn(`design-system/tokens/ is empty and no tokens snapshot found at ${path.relative(workingPath, tokensPath)}. Run \`handoff-app fetch\` first.`);
        process.exit(1);
      }
    }

    // ── Step 2: CSS brand file parsing (optional) ────────────────────────
    const brandsConfig = handoff.config?.brands;
    if (brandsConfig?.sharedCss && brandsConfig.entries?.length) {
      Logger.info(`Parsing ${brandsConfig.entries.length} brand CSS file(s)...`);
      const resolve = (p: string) =>
        path.isAbsolute(p) ? p : path.resolve(workingPath, p);
      try {
        const counts = await parseCssBrands({
          workingPath,
          sharedCss: resolve(brandsConfig.sharedCss),
          brands: brandsConfig.entries.map(({ brand, filePath }) => ({
            brand,
            filePath: resolve(filePath),
          })),
        });
        for (const [label, count] of Object.entries(counts)) {
          Logger.info(`  ${label.padEnd(16)}${count} tokens`);
        }

        // Merge brand metadata into the manifest written by migrateLegacyTokens
        const manifestPath = path.join(workingPath, 'design-system', 'manifest.json');
        if (await fs.pathExists(manifestPath)) {
          const manifest = await fs.readJson(manifestPath);
          const brandNames = brandsConfig.entries.map((e) => e.brand);
          manifest.brands = brandNames;
          manifest.counts = {
            ...manifest.counts,
            ...Object.fromEntries(
              Object.entries(counts).map(([label, count]) => [`brand:${label}`, count])
            ),
          };
          const cssSources = brandNames.map((b) => `css:${b}`);
          if (!Array.isArray(manifest.sources)) manifest.sources = [];
          for (const src of cssSources) {
            if (!manifest.sources.includes(src)) manifest.sources.push(src);
          }
          await fs.writeJson(manifestPath, manifest, { spaces: 2 });
        }
      } catch (e) {
        Logger.warn(`Brand CSS parsing failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Step 3: Style Dictionary transform ───────────────────────────────
    Logger.info('Transforming tokens to CSS / SCSS / Tailwind / DTCG...');
    await transformTokens(workingPath);

    // ── Step 4: Ensure at least one brand exists ──────────────────────────
    // ColorsDisplay requires brand-structured token data. If no brands/
    // directory was configured (common for Figma-only or migrated projects),
    // synthesise a "default" brand from the resolved color tokens so the
    // colors foundation page always renders swatches.
    await ensureDefaultBrand(workingPath);

    Logger.success('tokens:build complete → design-system/dist/');
  },
};

export default command;
