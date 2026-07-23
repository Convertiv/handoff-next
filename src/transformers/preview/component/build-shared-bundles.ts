import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import Handoff from '@handoff/index';
import { DEFAULT_CLIENT_BUILD_CONFIG, resolveModule } from '@handoff/transformers/utils/build';
import { generateClientHydrationSource } from '@handoff/transformers/plugins/ssr-render';
import { Logger } from '@handoff/utils/logger';
import { getComponentDistPath } from './api';

/**
 * Vendor-isolated component-library build (roadmap 6.6).
 *
 * Instead of re-bundling React + the whole component library into EVERY
 * component's `<id>-client.mjs` (~1.3MB each), this phase runs once after all
 * components are built and:
 *
 *   1. Emits the React ecosystem as two shared, content-hashed ESM bundles
 *      (`react` + `jsx-runtime`; `react-dom` + `react-dom/client`).
 *   2. Emits each config-declared shared package (e.g. the workspace component
 *      library) as its own shared bundle, with React marked external.
 *   3. Rebuilds each component's client entry with the React ecosystem AND the
 *      shared packages marked `external` — so each entry drops to a few KB and
 *      imports its vendors by BARE specifier.
 *   4. Writes an importmap (`hvendor-importmap.json`) that maps those bare
 *      specifiers to the hashed shared files, plus a manifest for downstream
 *      consumers (static HTML / HubSpot), and injects the importmap into each
 *      component's static preview HTML.
 *
 * The shared bundles load ONCE and cache immutably; a multi-component page (the
 * playground, a HubSpot landing) pays for React + the library a single time.
 *
 * IMPORTANT (learned the hard way): an `onResolve` plugin OVERRIDES esbuild's
 * `external` array. Both `createReactResolvePlugin` AND workspace
 * `hooks.clientBuildConfig` resolve plugins (e.g. 8x8's, which force-resolves
 * its component library to a sibling source dir) would re-bundle a package we
 * want externalized. So externalization is done with OUR OWN `onResolve` plugin
 * prepended to the plugin list (first plugin wins) — it beats any hook plugin.
 * That lets the shared-library build still run the workspace hook (for its
 * `.css`/`.png` loaders + correct library resolution) while entries keep the
 * library external. `externalizePlugin` also matches subpaths, so listing
 * `react` covers `react/jsx-runtime` and `react-dom` covers `react-dom/client`.
 */

/** Prefix marking a file as a shared (vendor) artifact — used for routing, serving, cleanup, and push collection. */
export const SHARED_ARTIFACT_PREFIX = 'hvendor-';
export const SHARED_IMPORTMAP_FILE = `${SHARED_ARTIFACT_PREFIX}importmap.json`;
export const SHARED_MANIFEST_FILE = `${SHARED_ARTIFACT_PREFIX}manifest.json`;

/** The React specifiers that are ALWAYS shared/externalized from component entries. */
const REACT_ECOSYSTEM_SPECIFIERS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'];

export interface ReactSplitInput {
  id: string;
  /** Absolute path to the component template (default export). */
  templatePath: string;
  /** Absolute path to the declaration file (for `fields[*].render`), if any. */
  declarationPath?: string;
  hasFields: boolean;
}

const requireCjs = createRequire(import.meta.url);

function shortHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
}

/**
 * The named exports a downstream ESM `import { x } from '<spec>'` can bind to
 * MUST be STATIC. React & friends are CommonJS, so `export * from 'react'`
 * produces DYNAMIC re-exports that a static named import can't see at runtime
 * ("does not provide an export named 'jsxs'"). We instead enumerate the actual
 * exports (via require) and emit them explicitly as `export const { … } = …`.
 * This is the esm.sh/skypack approach. We include internal (`__…`) keys too —
 * react-dom statically imports React's internals across the module boundary.
 */
function namedExportsOf(resolvedPath: string): string[] {
  try {
    const mod = requireCjs(resolvedPath);
    if (!mod || typeof mod !== 'object') return [];
    return Object.keys(mod).filter((k) => k !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
  } catch {
    return [];
  }
}

/**
 * Banner that shims CommonJS `require('react'|'react-dom'|…)` for bundles that
 * externalize React. esbuild's `__require` falls back to a lexically-visible
 * `require`, so we define one that returns the ESM-imported (importmap-resolved)
 * namespace. Without this, a CJS dep's `require('react')` throws "Dynamic
 * require of react is not supported" at runtime. Only react-ecosystem specifiers
 * need it (their CJS internals use require); the library's own code is ESM.
 */
function requireShimBanner(externalSpecifiers: string[]): string {
  const relevant = externalSpecifiers.filter((s) => /^react(-dom)?(\/.*)?$/.test(s));
  if (!relevant.length) return '';
  const imports = relevant.map((s, i) => `import * as __ext${i} from ${JSON.stringify(s)};`).join('\n');
  const cases = relevant.map((s, i) => `if (id === ${JSON.stringify(s)}) return __ext${i}.default ?? __ext${i};`).join(' ');
  return `${imports}\nvar require = (id) => { ${cases} throw new Error('Dynamic require of ' + id + ' is not supported'); };`;
}

/** Emit `import __m from '<spec>'; export default __m; export const {names}=__m;` — static named exports. */
function cjsShimSource(entries: Array<{ spec: string; local: string; names: string[] }>, defaultLocal: string): string {
  const imports = entries
    .map((e) => (e.names.length || e.local === defaultLocal ? `import * as ${e.local} from '${e.spec}';` : ''))
    .filter(Boolean)
    .join('\n');
  const named = entries
    .filter((e) => e.names.length)
    .map((e) => `export const { ${e.names.join(', ')} } = ${e.local};`)
    .join('\n');
  return `${imports}\nexport default ${defaultLocal}.default ?? ${defaultLocal};\n${named}\n`;
}

function sanitizePkg(pkg: string): string {
  return pkg.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Resolves the FULL React ecosystem (`react`, `react-dom`, `react-dom/client`,
 * `react/jsx-runtime`) from the same search dirs the per-component build uses
 * ([workingPath, modulePath/node_modules]) — so the owner bundles resolve the
 * SAME React the workspace uses, regardless of `resolveDir`. Broader than
 * `createReactResolvePlugin`, which omits bare `react-dom`.
 */
function reactEcosystemResolver(handoff: Handoff): esbuild.Plugin {
  const searchDirs = [handoff.workingPath, path.join(handoff.modulePath, 'node_modules')];
  const owned = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']);
  return {
    name: 'handoff-resolve-react-ecosystem',
    setup(build) {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
        if (!owned.has(args.path)) return null;
        try {
          return { path: resolveModule(args.path, searchDirs) };
        } catch {
          return null;
        }
      });
    },
  };
}

/**
 * Marks the given bare specifiers (and their subpaths) as external. Prepended
 * to the plugin list so it wins over any hook/react-resolve `onResolve` that
 * would otherwise re-bundle them.
 */
function externalizePlugin(specifiers: string[]): esbuild.Plugin {
  return {
    name: 'handoff-externalize-shared',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        for (const s of specifiers) {
          if (args.path === s || args.path.startsWith(`${s}/`)) {
            return { path: args.path, external: true };
          }
        }
        return null;
      });
    },
  };
}

interface BuildOneOpts {
  contents: string;
  /** Bare specifiers (and subpaths) to keep external via our own onResolve plugin. */
  externalSpecifiers: string[];
  resolveDir: string;
  /** Resolve+bundle the React ecosystem (react/react-dom owner bundles only). */
  resolveReact: boolean;
  /** Apply the workspace `hooks.clientBuildConfig` (for loaders + library resolution). */
  applyHook: boolean;
  handoff: Handoff;
}

async function buildOne({ contents, externalSpecifiers, resolveDir, resolveReact, applyHook, handoff }: BuildOneOpts): Promise<string> {
  let cfg: esbuild.BuildOptions = {
    ...DEFAULT_CLIENT_BUILD_CONFIG,
    logLevel: 'silent',
    stdin: { contents, resolveDir, loader: 'tsx' },
    plugins: [
      // MUST be first — beats hook/react-resolve onResolve for shared specifiers.
      ...(externalSpecifiers.length ? [externalizePlugin(externalSpecifiers)] : []),
      ...(resolveReact ? [reactEcosystemResolver(handoff)] : []),
    ],
  };
  if (applyHook && handoff.config?.hooks?.clientBuildConfig) {
    cfg = handoff.config.hooks.clientBuildConfig(cfg);
  }
  // Add the CJS require-shim banner AFTER the hook (so it sits at the very top,
  // where its `var require` precedes esbuild's __require). Merge if the hook set one.
  const shim = requireShimBanner(externalSpecifiers);
  if (shim) {
    cfg.banner = { ...cfg.banner, js: [shim, cfg.banner?.js].filter(Boolean).join('\n') };
  }
  const built = await esbuild.build(cfg);
  if (built.warnings.length > 0) {
    const messages = await esbuild.formatMessages(built.warnings, { kind: 'warning', color: true });
    messages.forEach((msg) => Logger.warn(msg));
  }
  return built.outputFiles![0].text;
}

/**
 * Injects the importmap into every static preview HTML file in a component's
 * dist dir. The importmap must precede any `<script type="module">`, so it goes
 * right after `<head>`. ssr-render regenerates HTML fresh each build (no
 * importmap), so re-injection is expected; the guard prevents double-inject.
 */
async function injectImportmapIntoHtml(distDir: string, importmap: { imports: Record<string, string> }): Promise<void> {
  const files = (await fs.readdir(distDir).catch(() => [] as string[])).filter((f) => f.endsWith('.html'));
  const tag = `<script type="importmap">${JSON.stringify(importmap)}</script>`;
  for (const f of files) {
    const p = path.join(distDir, f);
    let html = await fs.readFile(p, 'utf8').catch(() => '');
    if (!html || html.includes('type="importmap"')) continue;
    html = html.includes('<head>') ? html.replace('<head>', `<head>\n    ${tag}`) : `${tag}\n${html}`;
    await fs.writeFile(p, html, 'utf8');
  }
}

/**
 * Build the shared vendor bundles + tiny component entries + importmap/manifest.
 * No-op when there are no React components to split.
 */
export async function buildSharedClientBundles(handoff: Handoff, inputs: ReactSplitInput[]): Promise<void> {
  if (!inputs.length) return;

  const base = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const url = (file: string) => `${base}/api/component/${file}`;
  const sharedDir = path.resolve(handoff.workingPath, 'public/api/component');
  await fs.ensureDir(sharedDir);

  const sharedPackages = handoff.config?.preview?.sharedPackages ?? [];

  const sharedFiles: Record<string, string> = {};
  const importmap = { imports: {} as Record<string, string> };
  const manifestPackages: Record<string, string> = {};

  // Resolve the workspace's React on disk so we can enumerate its real exports.
  const searchDirs = [handoff.workingPath, path.join(handoff.modulePath, 'node_modules')];
  const namesFor = (spec: string): string[] => {
    let resolved: string | null = null;
    try {
      resolved = resolveModule(spec, searchDirs);
    } catch {
      return [];
    }
    return resolved ? namedExportsOf(resolved) : [];
  };

  // 1. React ecosystem — ONE combined bundle for react + react-dom +
  //    react-dom/client + jsx-runtime. Bundling them together means react-dom's
  //    internal `require('react')` resolves to the SAME bundled React (no
  //    external-require throw, no duplicate React → no "invalid hook call").
  //    Named exports are emitted STATICALLY (enumerated + deduped in order) so
  //    downstream `import { useState/jsx/jsxs/createRoot }` resolve at runtime.
  const reactNames = namesFor('react');
  const seen = new Set(reactNames);
  const dedup = (spec: string): string[] => {
    const fresh = namesFor(spec).filter((n) => !seen.has(n));
    fresh.forEach((n) => seen.add(n));
    return fresh;
  };
  const jsxNames = dedup('react/jsx-runtime');
  const reactDomNames = dedup('react-dom');
  const reactDomClientNames = dedup('react-dom/client');
  const reactCode = await buildOne({
    contents: cjsShimSource(
      [
        { spec: 'react', local: '__react', names: reactNames },
        { spec: 'react/jsx-runtime', local: '__jsx', names: jsxNames },
        { spec: 'react-dom', local: '__rd', names: reactDomNames },
        { spec: 'react-dom/client', local: '__rdc', names: reactDomClientNames },
      ],
      '__react'
    ),
    externalSpecifiers: [],
    resolveDir: handoff.workingPath,
    resolveReact: true,
    applyHook: false,
    handoff,
  });
  const reactFile = `${SHARED_ARTIFACT_PREFIX}react-${shortHash(reactCode)}.mjs`;
  sharedFiles[reactFile] = reactCode;

  for (const spec of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] as const) {
    importmap.imports[spec] = url(reactFile);
    manifestPackages[spec] = reactFile;
  }

  // 2. Shared packages (e.g. the component library) — React external.
  for (const pkg of sharedPackages) {
    let code: string;
    try {
      code = await buildOne({
        contents: `export * from '${pkg}';`,
        externalSpecifiers: ['react', 'react-dom'],
        resolveDir: handoff.workingPath,
        resolveReact: false,
        // Run the workspace hook so its loaders (.css/.png → empty) and library
        // resolution (e.g. → sibling source) apply while the barrel is bundled.
        applyHook: true,
        handoff,
      });
    } catch (err) {
      Logger.error(`Shared bundle: failed to build package "${pkg}" — components will fall back to their existing bundles.`);
      Logger.error(String((err as Error)?.message ?? err));
      return; // Abort: without the library bundle the tiny entries can't resolve it.
    }
    const file = `${SHARED_ARTIFACT_PREFIX}lib-${sanitizePkg(pkg)}-${shortHash(code)}.mjs`;
    sharedFiles[file] = code;
    importmap.imports[pkg] = url(file);
    manifestPackages[pkg] = file;
  }

  // 3. Component entries — externalize the React ecosystem + shared packages.
  const externalForComponents = [...REACT_ECOSYSTEM_SPECIFIERS, ...sharedPackages];
  const componentManifest: Record<string, string> = {};
  let entryFailures = 0;

  for (const input of inputs) {
    const source = generateClientHydrationSource(input.templatePath, input.declarationPath, input.hasFields);
    let code: string;
    try {
      code = await buildOne({
        contents: source,
        externalSpecifiers: externalForComponents,
        resolveDir: handoff.workingPath,
        resolveReact: false,
        // Hook gives loaders for any non-shared template imports; our externalize
        // plugin (prepended) still keeps react + shared packages external.
        applyHook: true,
        handoff,
      });
    } catch (err) {
      Logger.error(`Shared bundle: failed to build client entry for "${input.id}" — leaving its existing bundle in place.`);
      entryFailures++;
      continue;
    }
    const distDir = getComponentDistPath(handoff, input.id);
    await fs.ensureDir(distDir);
    const entryFile = `${input.id}-client.mjs`;
    await fs.writeFile(path.join(distDir, entryFile), code, 'utf8');
    componentManifest[input.id] = entryFile;
    await injectImportmapIntoHtml(distDir, importmap);
  }

  // 4. Clean stale hashed shared bundles, then write the fresh set + metadata.
  const existing = await fs.readdir(sharedDir).catch(() => [] as string[]);
  for (const name of existing) {
    if (name.startsWith(SHARED_ARTIFACT_PREFIX) && name.endsWith('.mjs') && !(name in sharedFiles)) {
      await fs.remove(path.join(sharedDir, name)).catch(() => {});
    }
  }
  for (const [file, code] of Object.entries(sharedFiles)) {
    await fs.writeFile(path.join(sharedDir, file), code, 'utf8');
  }
  await fs.writeFile(path.join(sharedDir, SHARED_IMPORTMAP_FILE), JSON.stringify(importmap, null, 2), 'utf8');
  await fs.writeFile(
    path.join(sharedDir, SHARED_MANIFEST_FILE),
    JSON.stringify({ version: 1, importmap: importmap.imports, packages: manifestPackages, components: componentManifest }, null, 2),
    'utf8'
  );

  Logger.info(
    `Shared vendor bundles: ${Object.keys(sharedFiles).length} shared files (${sharedPackages.length} package${sharedPackages.length === 1 ? '' : 's'} + React), ` +
      `${Object.keys(componentManifest).length} component entries${entryFailures ? `, ${entryFailures} failed` : ''}.`
  );
}
