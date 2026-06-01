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

const HANDOFF_APP_ROOT = APP_DIR;
const HANDOFF_WORKING_PATH = resolveAbsoluteFromApp('%HANDOFF_WORKING_PATH_REL%', path.resolve(APP_DIR, '..', '..'));
const HANDOFF_MODULE_PATH = resolveAbsoluteFromApp(
  '%HANDOFF_MODULE_PATH_REL%',
  path.resolve(APP_DIR, '..', '..', 'node_modules', 'handoff-app')
);
const HANDOFF_EXPORT_PATH = resolveAbsoluteFromApp('%HANDOFF_EXPORT_PATH_REL%', '');
const HANDOFF_TURBOPACK_ROOT = resolveAbsoluteFromApp('%HANDOFF_TURBOPACK_ROOT_REL%', APP_DIR);
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
