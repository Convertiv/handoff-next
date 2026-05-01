import fs from 'fs-extra';
import path from 'path';
import { InlineConfig, Plugin, build as viteBuild } from 'vite';
import { initRuntimeConfig } from '../../../config';
import Handoff from '../../../index';
import { formatDurationMs } from '../../../utils/duration';
import { Logger } from '../../../utils/logger';
import viteBaseConfig from '../../vite-config';
import { getComponentOutputPath } from '../component';
import { TransformComponentTokensResult } from '../types';
const { pathToFileURL } = require('url');

export const MAIN_COMPONENT_CSS_FILE = 'main.css';
export const SHARED_COMPONENT_CSS_FILE = 'shared.css';

/**
 * Builds a CSS bundle using Vite
 *
 * @param options - The options object
 * @param options.entry - The entry file path for the bundle
 * @param options.outputPath - The directory where the bundle will be output
 * @param options.outputFilename - The name of the output file
 * @param options.loadPaths - Array of paths for SASS to look for imports
 * @param options.handoff - The Handoff configuration object
 */
const buildCssBundle = async ({
  entry,
  outputPath,
  outputFilename,
  loadPaths,
  handoff,
}: {
  entry: string;
  outputPath: string;
  outputFilename: string;
  loadPaths: string[];
  handoff: Handoff;
}): Promise<void> => {
  // Store the current NODE_ENV value
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    const absEntry = path.resolve(entry);

    // Write a tiny JS wrapper that imports the real CSS/SCSS entry.
    // This prevents Vite 8's vite:css-post plugin from treating the entry
    // chunk as a "pure CSS chunk," which triggers a referenceId lookup bug
    // in Rolldown's generateBundle hook.
    const wrapperDir = path.resolve(outputPath, '.handoff-css-tmp');
    const wrapperFile = path.resolve(wrapperDir, '_css_entry.js');
    await fs.ensureDir(wrapperDir);
    await fs.writeFile(wrapperFile, `import ${JSON.stringify(absEntry)};\nexport default 0;\n`);

    // Rename the emitted CSS asset to the desired filename and remove the
    // JS stub chunk from the bundle so only the CSS is written to disk.
    const renameCssPlugin: Plugin = {
      name: 'handoff-rename-css',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (fileName.endsWith('.css') && fileName !== outputFilename) {
            (asset as { fileName: string }).fileName = outputFilename;
            bundle[outputFilename] = asset;
            delete bundle[fileName];
          }
        }
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'chunk') {
            delete bundle[fileName];
          }
        }
      },
    };

    let viteConfig: InlineConfig = {
      ...viteBaseConfig,
      plugins: [...(viteBaseConfig.plugins || []), renameCssPlugin],
      build: {
        ...viteBaseConfig.build,
        outDir: outputPath,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: wrapperFile,
          formats: ['es'],
        },
      },
      css: {
        preprocessorOptions: {
          scss: {
            api: 'modern',
            loadPaths,
            quietDeps: true,
            silenceDeprecations: ['import', 'legacy-js-api'],
          },
        },
      },
    };

    // Allow configuration to be modified through hooks
    if (handoff?.config?.hooks?.cssBuildConfig) {
      viteConfig = handoff.config.hooks.cssBuildConfig(viteConfig);
    }

    try {
      await viteBuild(viteConfig);
    } finally {
      await fs.remove(wrapperDir).catch(() => {});
    }
  } catch (e) {
    Logger.error(`Failed to build CSS for "${entry}"`);
    throw e;
  } finally {
    // Restore the original NODE_ENV value
    if (oldNodeEnv === 'development' || oldNodeEnv === 'production' || oldNodeEnv === 'test') {
      (process.env as any).NODE_ENV = oldNodeEnv;
    } else {
      delete (process.env as any).NODE_ENV;
    }
  }
};

const buildComponentCss = async (data: TransformComponentTokensResult, handoff: Handoff) => {
  const id = data.id;
  Logger.debug(`buildComponentCss`, id);
  const outputPath = getComponentOutputPath(handoff);
  const builtCssPath = path.resolve(outputPath, `${id}.css`);
  const entry = data.entries?.scss;

  if (!entry) {
    // Keep generated output aligned with the current component declaration.
    await fs.remove(builtCssPath);
    delete data['css'];
    delete data['sass'];
    delete data['sharedStyles'];
    return data;
  }

  const extension = path.extname(entry);

  if (!extension) {
    return data;
  }

  try {
    if (extension === '.scss' || extension === '.css') {
      // Remove the previous artifact before rebuilding so "no emitted CSS"
      // doesn't silently preserve stale output from an earlier build.
      await fs.remove(builtCssPath);

      // Read the original source
      const sourceContent = await fs.readFile(entry, 'utf8');
      if (extension === '.scss') {
        data['sass'] = sourceContent;
      }

      // Setup SASS load paths
      const loadPaths = [
        path.resolve(handoff.workingPath),
        path.resolve(handoff.workingPath, handoff.exportsDirectory, handoff.getProjectId()),
        path.resolve(handoff.workingPath, 'node_modules'),
      ];

      if (handoff.runtimeConfig?.entries?.scss) {
        loadPaths.unshift(path.dirname(handoff.runtimeConfig.entries.scss));
      }

      await buildCssBundle({
        entry,
        outputPath,
        outputFilename: `${id}.css`,
        loadPaths,
        handoff,
      });

      // Read the built CSS
      if (fs.existsSync(builtCssPath)) {
        const builtCss = await fs.readFile(builtCssPath, 'utf8');
        data['css'] = builtCss;

        // Handle shared styles — if the component SCSS uses the split marker,
        // extract shared styles from the portion above it
        const splitCSS = builtCss.split('/* COMPONENT STYLES*/');
        if (splitCSS && splitCSS.length > 1) {
          data['css'] = splitCSS[1];
          data['sharedStyles'] = splitCSS[0];
          await fs.writeFile(path.resolve(outputPath, SHARED_COMPONENT_CSS_FILE), data['sharedStyles']);
        }
      } else {
        delete data['css'];
        delete data['sharedStyles'];
      }
    }
  } catch (e) {
    Logger.error(`Failed to build CSS for "${id}"`);
    throw e;
  }

  return data;
};

/**
 * Build the main CSS file using Vite
 */
export const buildMainCss = async (handoff: Handoff): Promise<void> => {
  const outputPath = getComponentOutputPath(handoff);
  const runtimeConfig = initRuntimeConfig(handoff)[0];

  if (runtimeConfig?.entries?.scss && fs.existsSync(runtimeConfig.entries.scss)) {
    const stat = await fs.stat(runtimeConfig.entries.scss);
    const entryPath = stat.isDirectory() ? path.resolve(runtimeConfig.entries.scss, 'main.scss') : runtimeConfig.entries.scss;

    if (entryPath === runtimeConfig.entries.scss || fs.existsSync(entryPath)) {
      Logger.info(`Building styles for global entry (${MAIN_COMPONENT_CSS_FILE})…`);
      const startedAt = Date.now();
      try {
        const loadPaths = [
          path.resolve(handoff.workingPath),
          path.resolve(handoff.workingPath, handoff.exportsDirectory, handoff.getProjectId()),
          path.resolve(handoff.workingPath, 'node_modules'),
        ];

        if (handoff.runtimeConfig?.entries?.scss) {
          loadPaths.unshift(path.dirname(handoff.runtimeConfig.entries.scss));
        }

        await buildCssBundle({
          entry: entryPath,
          outputPath,
          outputFilename: MAIN_COMPONENT_CSS_FILE,
          loadPaths,
          handoff,
        });
        Logger.info(
          `Finished building styles for global entry (${MAIN_COMPONENT_CSS_FILE}) in ${formatDurationMs(Date.now() - startedAt)}`
        );
      } catch {
        // buildCssBundle already logs failure for the entry path
      }
    }
  }
};

export default buildComponentCss;
