import next from 'eslint-config-next';
import prettier from 'eslint-config-prettier/flat';

/**
 * Flat-config port of the former `.eslintrc.json` (`extends: ["next", "prettier"]`),
 * required by ESLint 9, which no longer reads `.eslintrc.*` by default.
 *
 * `eslint-config-next` v16 already exports a flat config array and
 * `eslint-config-prettier/flat` is the flat build of the prettier config, so both drop
 * straight in — no FlatCompat shim needed. Prettier stays last so it can switch off the
 * stylistic rules the Next preset enables.
 *
 * `npm run lint` runs from `src/app`; ESLint walks up from the cwd to find this file and
 * uses the repo root as its base path, so the ignore patterns below are repo-relative.
 */

/*
 * Flat config requires a plugin to be in scope in the same config object that names its
 * rules, so the severity block below reuses the `react-hooks` instance the Next preset
 * already registers rather than adding a direct dependency on the plugin.
 */
const reactHooksPlugin = next.find((config) => config.plugins?.['react-hooks'])?.plugins['react-hooks'];
if (!reactHooksPlugin) {
  throw new Error("eslint-config-next no longer registers a 'react-hooks' plugin — update eslint.config.mjs.");
}

export default [
  {
    // Carried over verbatim from `.eslintrc.json`'s `ignorePatterns`.
    ignores: ['src/app/out/**', '**/*.js'],
  },

  ...next,

  {
    name: 'handoff/react-hooks-severity',
    plugins: { 'react-hooks': reactHooksPlugin },
    rules: {
      /*
       * `eslint-plugin-react-hooks` v7 (pulled in by eslint-config-next 16) turns the
       * React Compiler rule set on as errors. None of these rules existed in the plugin
       * version this repo's `.eslintrc.json` was written against, and the app has ~85
       * pre-existing violations. They are demoted to warnings so they stay visible in
       * `npm run lint` output without gating `npm test`.
       *
       * TODO: work these down and restore `error` per rule as each one reaches zero.
       *
       * `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` are deliberately
       * absent — they predate v7 and keep the preset's severities (`error` / `warn`).
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/gating': 'warn',
      'react-hooks/config': 'warn',
    },
  },

  prettier,
];
