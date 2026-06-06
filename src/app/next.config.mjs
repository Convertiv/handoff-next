import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resolveBasePath = (rawBasePath) => {
  if (!rawBasePath || rawBasePath.startsWith('%HANDOFF_')) {
    return '';
  }
  const trimmed = rawBasePath.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
};

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

const resolveAbsoluteFromApp = (relPath, fallback = '') => {
  if (relPath === undefined || relPath === null) {
    return fallback;
  }
  if (typeof relPath === 'string' && relPath.startsWith('%HANDOFF_')) {
    return fallback;
  }
  // `path.relative(app, working)` is '' when the Next app root equals the Handoff working root (layout `root`).
  if (relPath === '') {
    return path.resolve(APP_DIR);
  }
  return path.resolve(APP_DIR, relPath);
};

/**
 * Module path detection.
 *
 * Three deployment scenarios where this config is loaded:
 *
 *   (a) Materialized into a client's `.handoff/runtime/` via prepare-runtime —
 *       placeholders are substituted to absolute paths during materialization.
 *       Detected via the `%HANDOFF_*%` placeholders being replaced.
 *
 *   (b) Client uses handoff-app as a dependency (installed via npm) and runs
 *       `next build` from src/app/ at handoff-app's installed location. The
 *       module IS handoff-app and lives at <APP_DIR>/../..
 *
 *   (c) handoff-app is itself the deployed app (registry-as-service per
 *       ADR-001) — `next build` runs in src/app/ at the handoff-app repo root.
 *       The module is the repo root.
 *
 * Cases (b) and (c) both resolve to <APP_DIR>/../.. — that's the handoff-app
 * repo (or installed package) root. The old fallback at
 * <APP_DIR>/../../node_modules/handoff-app was wrong for case (c): when we ARE
 * handoff-app, we're not under our own node_modules.
 */
const REPO_ROOT_FROM_APP = path.resolve(APP_DIR, '..', '..');

const HANDOFF_APP_ROOT = APP_DIR;
const HANDOFF_WORKING_PATH = resolveAbsoluteFromApp('%HANDOFF_WORKING_PATH_REL%', REPO_ROOT_FROM_APP);
const HANDOFF_MODULE_PATH = resolveAbsoluteFromApp('%HANDOFF_MODULE_PATH_REL%', REPO_ROOT_FROM_APP);
const HANDOFF_EXPORT_PATH = resolveAbsoluteFromApp('%HANDOFF_EXPORT_PATH_REL%', '');
const HANDOFF_TURBOPACK_ROOT = resolveAbsoluteFromApp('%HANDOFF_TURBOPACK_ROOT_REL%', REPO_ROOT_FROM_APP);
const HANDOFF_DIST = path.resolve(HANDOFF_MODULE_PATH, 'dist');

/** Next bundles @handoff/* from compiled dist (.js); the materialized app uses @handoff/app → APP_DIR. */
const handoffResolveAlias = () => ({
  '@handoff/app': APP_DIR,
  '@handoff/transformers': path.join(HANDOFF_DIST, 'transformers'),
  '@handoff/config': path.join(HANDOFF_DIST, 'config'),
  '@handoff/types': path.join(HANDOFF_DIST, 'types'),
  '@handoff/figma': path.join(HANDOFF_DIST, 'figma'),
  '@handoff/declarations': path.join(HANDOFF_DIST, 'declarations'),
  '@handoff/utils': path.join(HANDOFF_DIST, 'utils'),
  '@': APP_DIR,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  trailingSlash: true,
  // Standalone output: Next.js writes a self-contained bundle to .next/standalone/
  // with only the traced node_modules deps copied in. Required for Vercel registry
  // deploys because our prepare-runtime symlinks node_modules from the repo root
  // into .handoff/runtime/, and Vercel's serverless function packager refuses to
  // follow that symlink ("framework produced an invalid deployment package for a
  // Serverless Function. Typically this means that the framework produces files
  // in symlinked directories"). With standalone, Vercel packages the resolved
  // copies inside .next/standalone, not the live symlink.
  output: 'standalone',
  serverExternalPackages: [
    '@resvg/resvg-js',
    'playwright-core',
    'better-sqlite3',
    'drizzle-orm/better-sqlite3',
    'drizzle-orm/better-sqlite3/migrator',
    // Native CLI tool; Turbopack must not parse optional @esbuild/* binaries or README assets.
    'esbuild',
  ],
  experimental: {
    externalDir: true,
  },
  transpilePackages: ['handoff-app', 'react-syntax-highlighter'],
  typescript: {
    tsconfigPath: 'tsconfig.json',
  },
  basePath: resolveBasePath('%HANDOFF_APP_BASE_PATH%'),
  // outputFileTracingRoot must be a parent directory containing BOTH the materialized
  // app (.handoff/runtime/) AND the actual node_modules being symlinked into it.
  // Without this, Vercel's serverless function packager refuses the deploy with
  // "The framework produced an invalid deployment package... files in symlinked
  // directories." Using HANDOFF_TURBOPACK_ROOT — it's already computed as the
  // common ancestor of (appPath, modulePath, node_modules) in app-builder/build.ts.
  outputFileTracingRoot: HANDOFF_TURBOPACK_ROOT,
  // Nav sidebars and doc pages read markdown/JSON from the materialized tree via runtime fs
  // (see getDefaultDocsDir, staticBuildMenu). Without this, Vercel lambdas omit config/docs
  // and public/api from the serverless bundle — menu is empty and Layout hides the sidebar.
  outputFileTracingIncludes: {
    '/**': ['./config/docs/**/*', './public/api/**/*', './client.config.json'],
  },
  env: {
    HANDOFF_PROJECT_ID: '%HANDOFF_PROJECT_ID%',
    HANDOFF_APP_BASE_PATH: '%HANDOFF_APP_BASE_PATH%',
    HANDOFF_APP_ROOT: HANDOFF_APP_ROOT,
    HANDOFF_WORKING_PATH: HANDOFF_WORKING_PATH,
    HANDOFF_MODULE_PATH: HANDOFF_MODULE_PATH,
    HANDOFF_EXPORT_PATH: HANDOFF_EXPORT_PATH,
    HANDOFF_WEBSOCKET_PORT: '%HANDOFF_WEBSOCKET_PORT%',
  },
  images: {
    unoptimized: false,
  },
  sassOptions: {
    additionalData: (content, _) => {
      let foundTheme = false;

      const env = {
        HANDOFF_PROJECT_ID: '%HANDOFF_PROJECT_ID%',
        HANDOFF_APP_BASE_PATH: '%HANDOFF_APP_BASE_PATH%',
        HANDOFF_APP_ROOT: HANDOFF_APP_ROOT,
        HANDOFF_WORKING_PATH: HANDOFF_WORKING_PATH,
        HANDOFF_MODULE_PATH: HANDOFF_MODULE_PATH,
        HANDOFF_EXPORT_PATH: HANDOFF_EXPORT_PATH,
        HANDOFF_WEBSOCKET_PORT: '%HANDOFF_WEBSOCKET_PORT%',
      };

      const clientConfigPath = path.resolve(/* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH, 'handoff.config.json');
      if (fs.existsSync(clientConfigPath)) {
        const clientConfigRaw = fs.readFileSync(clientConfigPath, 'utf-8');
        const clientConfig = JSON.parse(clientConfigRaw);
        if (typeof clientConfig === 'object' && !Array.isArray(clientConfig) && clientConfig !== null) {
          if (
            clientConfig.hasOwnProperty('app') &&
            clientConfig['app'].hasOwnProperty('theme') &&
            fs.existsSync(path.resolve(/* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH, 'theme', `${clientConfig['app']['theme']}.scss`))
          ) {
            foundTheme = true;
            content =
              content +
              `\n@import '${path.resolve(/* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH, 'theme', clientConfig['app']['theme'])}';`;
            console.log(
              `- info Using custom app theme (name: ${clientConfig['app']['theme']}, path: ${path.resolve(
                /* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH,
                'theme',
                clientConfig['app']['theme']
              )}.scss)`
            );
          }
        }
      }

      if (!foundTheme) {
        if (fs.existsSync(path.resolve(/* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH, 'theme', `default.scss`))) {
          content = content + `\n@import 'theme/default';`;
          console.log(
            `- info Using default app theme override (path: ${path.resolve(
              /* turbopackIgnore: true */ env.HANDOFF_WORKING_PATH,
              'theme',
              `default.scss`
            )})`
          );
        } else {
          content = content + `\n@import 'themes/default';`;
          console.log(`- info Using default app theme`);
        }
      }

      return content;
    },
  },
  turbopack: {
    root: HANDOFF_TURBOPACK_ROOT,
    resolveAlias: handoffResolveAlias(),
    resolveExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...handoffResolveAlias(),
    };
    return config;
  },
};

export default nextConfig;
