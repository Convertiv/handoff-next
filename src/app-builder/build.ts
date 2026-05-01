import spawn from 'cross-spawn';
import esbuild from 'esbuild';
import fs from 'fs-extra';
import { createRequire } from 'node:module';
import path from 'path';
import Handoff from '@handoff/index';
import { buildComponents } from '@handoff/pipeline/components';
import { buildPatterns } from '@handoff/pipeline/patterns';
import processComponents from '@handoff/transformers/preview/component/builder';
import { buildMainCss } from '@handoff/transformers/preview/component/css';
import { buildMainJS } from '@handoff/transformers/preview/component/javascript';
import { Logger } from '@handoff/utils/logger';
import { generatePlaygroundAssetsApi, generateTokensApi, persistClientConfig } from './client-config.js';
import { getAppPath, syncPublicFiles } from './paths.js';
import {
  WatcherState,
  getRuntimeComponentsPathsToWatch,
  watchAppSource,
  watchComponentDirectories,
  watchGlobalEntries,
  watchPages,
  watchPublicDirectory,
  watchRuntimeComponents,
  watchRuntimeConfiguration,
} from './watchers.js';
import { createWebSocketServer } from './websocket.js';

const escapeForSingleQuotedJsString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Directory to use as `.handoff/app/node_modules` target.
 * Tarball / hoisted installs often have no `node_modules` inside `handoff-app`;
 * dependencies live in an ancestor `node_modules` (e.g. client project root).
 */
function resolveHostNodeModulesDir(handoffModulePath: string): string | null {
  let dir = path.resolve(handoffModulePath);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'next', 'package.json');
    if (fs.existsSync(candidate)) {
      return path.join(dir, 'node_modules');
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Longest common ancestor directory of two absolute paths. */
function commonAncestorDir(p1: string, p2: string): string {
  const parts1 = path.resolve(p1).split(path.sep);
  const parts2 = path.resolve(p2).split(path.sep);
  const common: string[] = [];
  for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
    if (parts1[i] === parts2[i]) common.push(parts1[i]);
    else break;
  }
  return common.join(path.sep) || path.sep;
}

/** Run Next from handoff-app's dependency tree — avoids `npx next` when cwd has no node_modules (interactive install prompt). */
function resolveNextBinFromHandoffPackage(handoffModulePath: string): string {
  try {
    const req = createRequire(path.join(path.resolve(handoffModulePath), 'package.json'));
    return req.resolve('next/dist/bin/next');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not resolve Next.js from handoff-app at ${handoffModulePath}. Is "next" installed? ${msg}`
    );
  }
}

const MIDDLEWARE_HOOK_OUT = 'middleware-hook.mjs';

const writeStubMiddlewareHook = async (outFile: string): Promise<void> => {
  await fs.writeFile(outFile, 'export const userMiddleware = undefined;\n', 'utf-8');
};

/**
 * Bundles `hooks.middleware` from the project's handoff.config into the Next app root
 * so `middleware.ts` can import it. Stub when unset or unsupported (.json / .cjs).
 */
const materializeMiddlewareHookModule = async (handoff: Handoff, appPath: string): Promise<void> => {
  const outFile = path.join(appPath, MIDDLEWARE_HOOK_OUT);
  const configPath = handoff.getMainConfigFilePath();
  const userMw = handoff.config?.hooks?.middleware;

  if (typeof userMw !== 'function' || !configPath) {
    await writeStubMiddlewareHook(outFile);
    return;
  }

  const ext = path.extname(configPath).toLowerCase();
  if (ext === '.json') {
    await writeStubMiddlewareHook(outFile);
    return;
  }
  if (ext === '.cjs') {
    Logger.warn(
      '[handoff] hooks.middleware is not bundled for handoff.config.cjs; use handoff.config.ts, .js, or .mjs instead.'
    );
    await writeStubMiddlewareHook(outFile);
    return;
  }

  const base = path.basename(configPath);
  const resolveDir = path.dirname(configPath);
  const stdinContents = `import cfg from ${JSON.stringify(`./${base}`)};
const resolved = cfg.default ?? cfg;
export const userMiddleware = typeof resolved.hooks?.middleware === 'function' ? resolved.hooks.middleware : undefined;
`;
  const loader = ext === '.ts' || ext === '.mts' ? 'ts' : 'js';

  try {
    await esbuild.build({
      stdin: {
        contents: stdinContents,
        resolveDir,
        sourcefile: 'handoff-middleware-hook-entry.ts',
        loader,
      },
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      outfile: outFile,
      logLevel: 'silent',
      external: ['handoff-app'],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Logger.warn(`[handoff] Failed to bundle hooks.middleware (${msg}); no user middleware active.`);
    await writeStubMiddlewareHook(outFile);
  }
};

/**
 * Removes the materialized Next tree (`<workingPath>/.handoff/app/`).
 * SQLite at `<workingPath>/.handoff/local.db` and build cache at `.handoff/.cache/` are outside `app/` and are preserved.
 */
const cleanupAppDirectory = async (handoff: Handoff): Promise<void> => {
  const appPath = getAppPath(handoff);

  // Clean project app dir
  if (fs.existsSync(appPath)) {
    await fs.remove(appPath);
  }
};

/**
 * Prepares the project application by copying source files and configuring Next.js.
 *
 * @returns The path to the prepared application directory
 */
const initializeProjectApp = async (handoff: Handoff): Promise<string> => {
  const srcPath = path.resolve(handoff.modulePath, 'src', 'app');
  const appPath = getAppPath(handoff);

  // Publish tokens API and playground assets manifest
  await generateTokensApi(handoff);
  await generatePlaygroundAssetsApi(handoff);

  // Prepare project app dir
  await fs.ensureDir(appPath);
  await fs.copy(srcPath, appPath, {
    overwrite: true,
    filter: (file) => {
      const rel = path.relative(srcPath, file);
      if (rel.includes('next.config.mjs')) return false;
      if (rel.split(path.sep).includes('node_modules')) return false;
      return true;
    },
  });
  await syncPublicFiles(handoff);
  await materializeMiddlewareHookModule(handoff, appPath);

  const hostNodeModules = resolveHostNodeModulesDir(handoff.modulePath);
  // Symlink node_modules so Turbopack / Node resolve `next` from .handoff/app.
  // Prefer a hoisted ancestor (tarball install); fall back to handoff-app/node_modules.
  const appNodeModules = path.resolve(appPath, 'node_modules');
  const sourceNodeModules = hostNodeModules ?? path.resolve(handoff.modulePath, 'node_modules');
  if (fs.existsSync(sourceNodeModules)) {
    try {
      const existing = await fs.readlink(appNodeModules);
      const resolvedExisting = path.resolve(path.dirname(appNodeModules), existing);
      if (resolvedExisting !== path.resolve(sourceNodeModules)) {
        await fs.remove(appNodeModules);
        await fs.symlink(sourceNodeModules, appNodeModules, 'junction');
      }
    } catch {
      if (fs.existsSync(appNodeModules)) {
        await fs.remove(appNodeModules);
      }
      await fs.symlink(sourceNodeModules, appNodeModules, 'junction');
    }
  } else if (fs.existsSync(appNodeModules)) {
    await fs.remove(appNodeModules);
  }

  // Copy custom theme CSS if it exists in the user's project
  const customThemePath = path.resolve(handoff.workingPath, 'theme.css');
  const destPath = path.resolve(appPath, 'css', 'theme.css');
  if (fs.existsSync(customThemePath)) {
    await fs.copy(customThemePath, destPath, { overwrite: true });
    Logger.success(`Custom theme.css loaded`);
  } else {
    // create a empty theme.css file
    await fs.writeFile(destPath, '');
  }

  // Prepare project app configuration using stable placeholder replacement.
  const handoffProjectId = handoff.getProjectId();
  const handoffAppBasePath = handoff.config.app.base_path ?? '';
  const handoffWorkingPath = path.resolve(handoff.workingPath);
  const handoffModulePath = path.resolve(handoff.modulePath);
  const handoffExportPath = path.resolve(handoff.workingPath, handoff.exportsDirectory, handoff.getProjectId());
  const nextConfigPath = path.resolve(srcPath, 'next.config.mjs');
  const targetPath = path.resolve(appPath, 'next.config.mjs');
  const handoffWebsocketPort = handoff.config.app.ports?.websocket ?? 3001;
  const escapedAppBasePath = escapeForSingleQuotedJsString(handoffAppBasePath);
  const escapedProjectId = escapeForSingleQuotedJsString(handoffProjectId);
  const escapedWorkingPath = escapeForSingleQuotedJsString(handoffWorkingPath);
  const escapedModulePath = escapeForSingleQuotedJsString(handoffModulePath);
  const escapedExportPath = escapeForSingleQuotedJsString(handoffExportPath);
  const escapedWebsocketPort = escapeForSingleQuotedJsString(String(handoffWebsocketPort));
  // Turbopack root must be a common ancestor of the app, handoff-app, and the
  // resolved host node_modules (symlink target may be hoisted outside handoff-app).
  const turbopackRoot = commonAncestorDir(
    appPath,
    commonAncestorDir(handoffModulePath, path.resolve(sourceNodeModules))
  );
  const escapedTurbopackRoot = escapeForSingleQuotedJsString(turbopackRoot);

  const placeholderValues: Record<string, string> = {
    '%HANDOFF_PROJECT_ID%': escapedProjectId,
    '%HANDOFF_APP_BASE_PATH%': escapedAppBasePath,
    '%HANDOFF_WORKING_PATH%': escapedWorkingPath,
    '%HANDOFF_MODULE_PATH%': escapedModulePath,
    '%HANDOFF_EXPORT_PATH%': escapedExportPath,
    '%HANDOFF_WEBSOCKET_PORT%': escapedWebsocketPort,
    '%HANDOFF_TURBOPACK_ROOT%': escapedTurbopackRoot,
  };
  let nextConfigContent = await fs.readFile(nextConfigPath, 'utf-8');
  for (const [placeholder, value] of Object.entries(placeholderValues)) {
    nextConfigContent = nextConfigContent.split(placeholder).join(value);
  }
  // Only write next.config.mjs when content differs to avoid triggering
  // a Next.js dev-server restart on every watcher-driven re-init.
  let existingContent: string | undefined;
  try {
    existingContent = await fs.readFile(targetPath, 'utf-8');
  } catch {
    /* file doesn't exist yet */
  }
  if (existingContent !== nextConfigContent) {
    await fs.writeFile(targetPath, nextConfigContent);
  }

  // tsconfig paths must point at handoff-app/src from the materialized app dir.
  // The template uses ./../../src/* which only works when the app lived under
  // node_modules/handoff-app/.handoff/<id>/; under <workingPath>/.handoff/app
  // that would resolve into the client repo instead.
  const tsconfigPath = path.resolve(appPath, 'tsconfig.json');
  const tsconfigRaw = await fs.readFile(tsconfigPath, 'utf-8');
  const tsconfig = JSON.parse(tsconfigRaw) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  if (!tsconfig.compilerOptions) {
    tsconfig.compilerOptions = {};
  }
  if (!tsconfig.compilerOptions.paths) {
    tsconfig.compilerOptions.paths = {};
  }
  const relToModuleSrc = path.relative(appPath, path.join(handoffModulePath, 'src'));
  const posixRel = relToModuleSrc.split(path.sep).join('/');
  const handoffPathGlob = `${posixRel.startsWith('.') ? '' : './'}${posixRel}/*`;
  const prevHandoffGlob = tsconfig.compilerOptions.paths['@handoff/*']?.[0];
  if (prevHandoffGlob !== handoffPathGlob) {
    tsconfig.compilerOptions.paths['@handoff/*'] = [handoffPathGlob];
    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
  }

  return appPath;
};

/**
 * Build the Next.js documentation application.
 */
const buildApp = async (handoff: Handoff, skipComponents?: boolean): Promise<void> => {
  skipComponents = skipComponents ?? false;
  // Perform cleanup
  await cleanupAppDirectory(handoff);

  // Build components, then patterns (patterns depend on component output)
  if (!skipComponents) {
    await buildComponents(handoff);
    await buildPatterns(handoff);
  }

  // Prepare app
  const appPath = await initializeProjectApp(handoff);

  await persistClientConfig(handoff);

  const nextBin = resolveNextBinFromHandoffPackage(handoff.modulePath);
  const buildResult = spawn.sync(process.execPath, [nextBin, 'build'], {
    cwd: appPath,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  Logger.childProcessBuffer(buildResult.stdout);
  Logger.childProcessBuffer(buildResult.stderr);

  if (buildResult.status !== 0) {
    let errorMsg = `Next.js build failed with exit code ${buildResult.status}`;
    if (buildResult.error) {
      errorMsg += `\nSpawn error: ${buildResult.error.message}`;
    }
    throw new Error(errorMsg);
  }

  // Ensure output root directory exists
  const outputRoot = path.resolve(handoff.workingPath, handoff.sitesDirectory);
  await fs.ensureDir(outputRoot);

  // Clean the project output directory (if exists)
  const output = path.resolve(outputRoot, handoff.getProjectId());
  if (fs.existsSync(output)) {
    await fs.remove(output);
  }

  const staticOut = path.resolve(appPath, 'out');
  if (await fs.pathExists(staticOut)) {
    await fs.copy(staticOut, output);
  } else {
    Logger.warn(
      `[handoff] No out/ after next build (static export removed). The production app is at ${appPath} — run \`npx next start\` from that directory.`
    );
  }
};

/**
 * Watch the Next.js application.
 * Starts a custom dev server with Handoff-specific watchers and hot-reloading.
 */
export const watchApp = async (handoff: Handoff): Promise<void> => {
  // Initial processing of the components with caching enabled
  // This will skip rebuilding components whose source files haven't changed
  await processComponents(handoff, undefined, undefined, { useCache: true });
  await buildMainJS(handoff);
  await buildMainCss(handoff);

  // Build patterns after components are ready
  await buildPatterns(handoff);

  const appPath = await initializeProjectApp(handoff);

  // Persist client configuration
  await persistClientConfig(handoff);

  const state: WatcherState = {
    busy: false,
    pendingHandlers: new Map(),
    runtimeComponentsWatcher: null,
    runtimeConfigurationWatcher: null,
    componentDirectoriesWatcher: null,
  };

  // Watch app source (debounced via scheduleHandler — see watchers.ts)
  watchAppSource(handoff, state, initializeProjectApp);

  const hostname = 'localhost';
  const port = handoff.config.app.ports?.app ?? 3000;

  // purge out cache and stale bundler output (e.g. after switching webpack → Turbopack)
  const moduleOutput = path.resolve(appPath, 'out');
  if (fs.existsSync(moduleOutput)) {
    await fs.remove(moduleOutput);
    // create empty directory
    await fs.ensureDir(moduleOutput);
  }
  const nextCache = path.resolve(appPath, '.next');
  if (fs.existsSync(nextCache)) {
    await fs.remove(nextCache);
  }
  Logger.info(`Starting Next.js dev server at http://${hostname}:${port}…`);

  const nextBin = resolveNextBinFromHandoffPackage(handoff.modulePath);
  const nextProcess = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: appPath,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
    },
  });
  Logger.pipeChildStreams(nextProcess.stdout, nextProcess.stderr);

  nextProcess.on('error', (error) => {
    Logger.error(`Next.js dev process failed to start: ${error}`);
    process.exit(1);
  });

  nextProcess.on('close', (code, signal) => {
    if (code === 0) {
      Logger.success(`Next.js dev process exited normally`);
    } else if (signal) {
      Logger.warn(`Next.js dev process stopped (${signal})`);
    } else {
      Logger.error(`Next.js dev process exited with code ${code}`);
    }
    process.exit(code ?? 1);
  });

  const wss = await createWebSocketServer(handoff.config.app.ports?.websocket ?? 3001);

  const chokidarConfig = {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
  };

  watchPublicDirectory(handoff, wss, state, chokidarConfig);
  watchRuntimeComponents(handoff, state, getRuntimeComponentsPathsToWatch(handoff));
  watchRuntimeConfiguration(handoff, state);
  watchComponentDirectories(handoff, state, chokidarConfig);
  watchGlobalEntries(handoff, state, chokidarConfig);
  watchPages(handoff, chokidarConfig);
};

/**
 * Watch the Next.js application using the standard Next.js dev server.
 * This is useful for debugging the Next.js app itself without the Handoff overlay.
 */
export const devApp = async (handoff: Handoff): Promise<void> => {
  // Prepare app
  const appPath = await initializeProjectApp(handoff);

  // Purge app cache
  const moduleOutput = path.resolve(appPath, 'out');
  if (fs.existsSync(moduleOutput)) {
    await fs.remove(moduleOutput);
  }

  // Persist client configuration
  await persistClientConfig(handoff);

  const devPort = handoff.config.app.ports?.app ?? 3000;
  Logger.info(`Starting Next.js dev server on port ${devPort}…`);

  const nextBin = resolveNextBinFromHandoffPackage(handoff.modulePath);
  const devResult = spawn.sync(process.execPath, [nextBin, 'dev', '--port', String(devPort)], {
    cwd: appPath,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(devPort),
    },
  });

  Logger.childProcessBuffer(devResult.stdout);
  Logger.childProcessBuffer(devResult.stderr);

  if (devResult.status !== 0) {
    let errorMsg = `Next.js dev failed with exit code ${devResult.status}`;
    if (devResult.error) {
      errorMsg += `\nSpawn error: ${devResult.error.message}`;
    }
    throw new Error(errorMsg);
  }
};

export default buildApp;
