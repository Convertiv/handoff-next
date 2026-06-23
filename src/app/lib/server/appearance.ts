import 'server-only';
import type { AppearanceSettings } from '../db/registry-queries';

// ─── CSS variable descriptors ─────────────────────────────────────────────────

export type CssVarDescriptor = {
  variable: string;
  label: string;
  description: string;
  group: 'page' | 'brand' | 'ui';
};

export const CSS_VAR_DESCRIPTORS: CssVarDescriptor[] = [
  { variable: '--primary', label: 'Primary', description: 'Buttons, links, active elements', group: 'brand' },
  { variable: '--primary-foreground', label: 'Primary text', description: 'Text on primary-colored surfaces', group: 'brand' },
  { variable: '--background', label: 'Background', description: 'Page background', group: 'page' },
  { variable: '--foreground', label: 'Foreground', description: 'Body text', group: 'page' },
  { variable: '--muted', label: 'Muted', description: 'Subtle backgrounds, badges', group: 'page' },
  { variable: '--muted-foreground', label: 'Muted text', description: 'Secondary / hint text', group: 'page' },
  { variable: '--border', label: 'Border', description: 'Dividers, input borders', group: 'ui' },
  { variable: '--ring', label: 'Focus ring', description: 'Keyboard focus indicator', group: 'ui' },
  { variable: '--sidebar-primary', label: 'Sidebar accent', description: 'Active sidebar item', group: 'ui' },
  { variable: '--accent', label: 'Accent', description: 'Hover states, highlights', group: 'ui' },
];

// ─── Color conversion ─────────────────────────────────────────────────────────

/** Convert hex color to the HSL-component string format used by shadcn CSS vars.
 *  e.g. "#3b82f6" → "217 91% 60%"
 */
export function hexToHslComponents(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '0 0% 0%';

  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Convert HSL-component string back to hex, for <input type="color">.
 *  e.g. "217 91% 60%" → "#3b82f6"
 */
export function hslComponentsToHex(components: string): string {
  const parts = components.trim().split(/[\s,]+/);
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (isNaN(h) || isNaN(s) || isNaN(l)) return '#000000';

  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const val = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * val).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Normalise any color value (hex, rgb(...), hsl(...)) to hex for storage. */
export function normalizeColorToHex(value: string): string {
  const v = value.trim();
  if (v.startsWith('#')) return v;
  const hslMatch = v.match(/^hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*\)/i);
  if (hslMatch) {
    const [, h, s, l] = hslMatch.map(Number);
    const k = (n: number) => (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const val = l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * val).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  const rgbMatch = v.match(/^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)/i);
  if (rgbMatch) {
    return '#' + [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((c) => Math.round(Number(c)).toString(16).padStart(2, '0'))
      .join('');
  }
  return v;
}

// ─── DTCG token extraction ────────────────────────────────────────────────────

export type DtcgColorToken = {
  path: string;
  label: string;
  value: string; // normalized hex
};

export type DtcgFontFamily = {
  family: string;
  key: string;
};

function walkDtcgColors(node: Record<string, unknown>, path: string[]): DtcgColorToken[] {
  const results: DtcgColorToken[] = [];
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (typeof val !== 'object' || val === null) continue;
    const child = val as Record<string, unknown>;
    if (child.$type === 'color' && typeof child.$value === 'string') {
      const fullPath = [...path, key];
      results.push({
        path: fullPath.join('.'),
        label: fullPath.join(' › '),
        value: normalizeColorToHex(child.$value as string),
      });
    } else {
      results.push(...walkDtcgColors(child, [...path, key]));
    }
  }
  return results;
}

export function extractColorTokensFromDtcg(dtcg: Record<string, unknown>): DtcgColorToken[] {
  return walkDtcgColors(dtcg, []);
}

// ─── CSS generation ───────────────────────────────────────────────────────────

export function buildAppearanceCss(settings: AppearanceSettings): string {
  const lines: string[] = ['/* Handoff Appearance Override — generated by /account/appearance */'];

  const colorEntries = Object.entries(settings.colorOverrides ?? {});
  const hasFontSans = Boolean(settings.fontSans);
  const hasFontMono = Boolean(settings.fontMono);
  const hasLogo = Boolean(settings.logoVariantId || settings.customLogoSvg);

  if (colorEntries.length === 0 && !hasFontSans && !hasFontMono && !hasLogo) {
    return '';
  }

  if (colorEntries.length > 0 || hasFontSans || hasFontMono) {
    lines.push(':root {');
    for (const [variable, hex] of colorEntries) {
      const hsl = hexToHslComponents(hex);
      lines.push(`  ${variable}: ${hsl};`);
    }
    if (hasFontSans) {
      lines.push(`  --font-sans: '${settings.fontSans}', sans-serif;`);
    }
    if (hasFontMono) {
      lines.push(`  --font-mono: '${settings.fontMono}', monospace;`);
    }
    lines.push('}');
  }

  return lines.join('\n');
}
