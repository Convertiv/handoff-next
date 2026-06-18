/**
 * Transforms all *.tokens.json files under design-system/tokens/ into
 * the four standard output formats using Style Dictionary 4.
 *
 * Input:  design-system/tokens/{primitive,semantic}/*.tokens.json
 * Output: design-system/dist/
 *   css/tokens.css
 *   scss/_tokens.scss
 *   tailwind/theme.css
 *   dtcg/tokens.resolved.json
 */

import StyleDictionary from 'style-dictionary';
import fs from 'fs-extra';
import path from 'path';
import { Logger } from '@handoff/utils/logger';

function collectTokenFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTokenFiles(full));
    else if (entry.name.endsWith('.tokens.json')) files.push(full);
  }
  return files;
}

export async function transformTokens(workingPath: string): Promise<void> {
  const dsRoot   = path.join(workingPath, 'design-system');
  const tokensIn = path.join(dsRoot, 'tokens');
  const distOut  = path.join(dsRoot, 'dist');

  if (!(await fs.pathExists(tokensIn))) {
    throw new Error(`design-system/tokens/ not found. Run \`handoff-app tokens:build\` to generate it.`);
  }

  const tokenFiles = collectTokenFiles(tokensIn).map((f) => path.relative(workingPath, f));
  if (tokenFiles.length === 0) {
    throw new Error('No *.tokens.json files found under design-system/tokens/. Nothing to transform.');
  }

  // Tailwind 4 @theme block
  StyleDictionary.registerFormat({
    name: 'css/tailwind-theme',
    format({ dictionary }) {
      const lines = dictionary.allTokens.map((token) => {
        const name = token.name.replace(/_/g, '-');
        const raw  = token.$value;
        const val  = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
        return `  --${name}: ${val};`;
      });
      return `@theme {\n${lines.join('\n')}\n}\n`;
    },
  });

  // Alias-resolved DTCG passthrough
  StyleDictionary.registerFormat({
    name: 'json/dtcg-resolved',
    format({ dictionary }) {
      const out: Record<string, unknown> = {};
      for (const token of dictionary.allTokens) {
        let node = out;
        for (let i = 0; i < token.path.length - 1; i++) {
          const k = token.path[i];
          if (!node[k] || typeof node[k] !== 'object') node[k] = {};
          node = node[k] as Record<string, unknown>;
        }
        node[token.path[token.path.length - 1]] = {
          $type: token.$type,
          $value: token.$value,
          ...(token.$description ? { $description: token.$description } : {}),
          ...(token.$extensions  ? { $extensions:  token.$extensions  } : {}),
        };
      }
      return JSON.stringify(out, null, 2) + '\n';
    },
  });

  const distRel = path.relative(workingPath, distOut).replace(/\\/g, '/');

  const sd = new StyleDictionary({
    source: tokenFiles,
    log: { verbosity: 'silent' },
    platforms: {
      css: {
        transformGroup: 'css',
        prefix: '',
        buildPath: `${distRel}/css/`,
        files: [{ destination: 'tokens.css', format: 'css/variables' }],
      },
      scss: {
        transformGroup: 'scss',
        prefix: '',
        buildPath: `${distRel}/scss/`,
        files: [{ destination: '_tokens.scss', format: 'scss/variables' }],
      },
      tailwind: {
        transformGroup: 'css',
        prefix: '',
        buildPath: `${distRel}/tailwind/`,
        files: [{ destination: 'theme.css', format: 'css/tailwind-theme' }],
      },
      dtcg: {
        transformGroup: 'js',
        buildPath: `${distRel}/dtcg/`,
        files: [{ destination: 'tokens.resolved.json', format: 'json/dtcg-resolved' }],
      },
    },
  });

  // Style Dictionary 4 builds from the cwd of the process; set it to workingPath
  const origCwd = process.cwd();
  process.chdir(workingPath);
  try {
    await sd.buildAllPlatforms();
  } finally {
    process.chdir(origCwd);
  }

  const outputs = [
    path.join(distOut, 'css', 'tokens.css'),
    path.join(distOut, 'scss', '_tokens.scss'),
    path.join(distOut, 'tailwind', 'theme.css'),
    path.join(distOut, 'dtcg', 'tokens.resolved.json'),
  ];

  for (const f of outputs) {
    const rel  = path.relative(workingPath, f);
    const size = fs.existsSync(f)
      ? `${Math.round((fs.statSync(f).size / 1024) * 10) / 10} kB`
      : 'MISSING';
    Logger.info(`  ${rel.padEnd(48)} ${size}`);
  }
}
