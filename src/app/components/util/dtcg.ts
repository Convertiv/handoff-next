import fs from 'fs';
import path from 'path';

const DS_DIST = path.resolve(process.cwd(), 'design-system', 'dist');
const DS_ROOT = path.resolve(process.cwd(), 'design-system');

export type DtcgTokenType = 'color' | 'typography' | 'shadow';

export interface DtcgTokenStrings {
  css: string;
  scss: string;
  tailwind: string;
  dtcg: string;
}

export interface DtcgManifest {
  project: string;
  generatedAt: string;
  sources: string[];
  counts: Record<string, number>;
}

function filterCssLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `:root {\n${lines.join('\n')}\n}`;
}

function filterScssLines(content: string, prefix: string): string {
  return content
    .split('\n')
    .filter((l) => l.trim().startsWith(`$${prefix}`))
    .join('\n');
}

function filterTailwindLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `@theme {\n${lines.join('\n')}\n}`;
}

export function fetchDtcgTokenStrings(type: DtcgTokenType): DtcgTokenStrings | null {
  try {
    const cssPath      = path.join(DS_DIST, 'css', 'tokens.css');
    const scssPath     = path.join(DS_DIST, 'scss', '_tokens.scss');
    const tailwindPath = path.join(DS_DIST, 'tailwind', 'theme.css');
    const dtcgPath     = path.join(DS_DIST, 'dtcg', 'tokens.resolved.json');

    if (![cssPath, scssPath, tailwindPath, dtcgPath].every((p) => fs.existsSync(p))) return null;

    const cssRaw      = fs.readFileSync(cssPath, 'utf-8');
    const scssRaw     = fs.readFileSync(scssPath, 'utf-8');
    const tailwindRaw = fs.readFileSync(tailwindPath, 'utf-8');
    const dtcgRaw     = JSON.parse(fs.readFileSync(dtcgPath, 'utf-8')) as Record<string, unknown>;

    return {
      css:      filterCssLines(cssRaw, type),
      scss:     filterScssLines(scssRaw, type),
      tailwind: filterTailwindLines(tailwindRaw, type),
      dtcg:     JSON.stringify(dtcgRaw[type] ?? {}, null, 2),
    };
  } catch {
    return null;
  }
}

export function fetchDtcgManifest(): DtcgManifest | null {
  try {
    const manifestPath = path.join(DS_ROOT, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as DtcgManifest;
  } catch {
    return null;
  }
}
