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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  trailingSlash: true,
  serverExternalPackages: ['@resvg/resvg-js', 'playwright-core', 'better-sqlite3', 'drizzle-orm/better-sqlite3', 'drizzle-orm/better-sqlite3/migrator'],
  experimental: {
    externalDir: true,
  },
  transpilePackages: ['handoff-app', 'react-syntax-highlighter'],
  typescript: {
    tsconfigPath: 'tsconfig.json',
  },
  basePath: resolveBasePath('%HANDOFF_APP_BASE_PATH%'),
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

      const clientConfigPath = path.resolve(env.HANDOFF_WORKING_PATH, 'handoff.config.json');
      if (fs.existsSync(clientConfigPath)) {
        const clientConfigRaw = fs.readFileSync(clientConfigPath, 'utf-8');
        const clientConfig = JSON.parse(clientConfigRaw);
        if (typeof clientConfig === 'object' && !Array.isArray(clientConfig) && clientConfig !== null) {
          if (
            clientConfig.hasOwnProperty('app') &&
            clientConfig['app'].hasOwnProperty('theme') &&
            fs.existsSync(path.resolve(env.HANDOFF_WORKING_PATH, 'theme', `${clientConfig['app']['theme']}.scss`))
          ) {
            foundTheme = true;
            content =
              content +
              `\n@import '${path.resolve(env.HANDOFF_WORKING_PATH, 'theme', clientConfig['app']['theme'])}';`;
            console.log(
              `- info Using custom app theme (name: ${clientConfig['app']['theme']}, path: ${path.resolve(
                env.HANDOFF_WORKING_PATH,
                'theme',
                clientConfig['app']['theme']
              )}.scss)`
            );
          }
        }
      }

      if (!foundTheme) {
        if (fs.existsSync(path.resolve(env.HANDOFF_WORKING_PATH, 'theme', `default.scss`))) {
          content = content + `\n@import 'theme/default';`;
          console.log(
            `- info Using default app theme override (path: ${path.resolve(
              env.HANDOFF_WORKING_PATH,
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
    resolveAlias: {
      '@handoff': path.resolve(HANDOFF_MODULE_PATH, 'src'),
      '@': path.resolve('.'),
    },
    resolveExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@handoff': path.resolve(HANDOFF_MODULE_PATH, 'src'),
      '@': path.resolve('.'),
    };
    return config;
  },
};

export default nextConfig;
