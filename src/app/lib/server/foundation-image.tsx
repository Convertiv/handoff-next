import 'server-only';

import type { Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import React from 'react';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { DesignWorkbenchFoundationContext } from '@/app/design/workbench-types';

const WIDTH = 1024;
const PAD = 40;

type SatoriWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type FontEntry = { name: string; data: ArrayBuffer; weight: SatoriWeight; style: 'normal' };

const GOOGLE_FONTS_UA =
  'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0 Safari/533.21.1';

/** Resolved font bytes after local + Google lookup */
const resolvedFontCache = new Map<string, Promise<ArrayBuffer | null>>();

const googleFontOnlyCache = new Map<string, Promise<ArrayBuffer | null>>();

async function fetchGoogleFontTtf(family: string, weight: number): Promise<ArrayBuffer | null> {
  const cacheKey = `google::${family}::${weight}`;
  if (googleFontOnlyCache.has(cacheKey)) return googleFontOnlyCache.get(cacheKey)!;

  const promise = (async (): Promise<ArrayBuffer | null> => {
    try {
      const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`;
      const cssRes = await fetch(cssUrl, { headers: { 'User-Agent': GOOGLE_FONTS_UA } });
      if (!cssRes.ok) return null;
      const css = await cssRes.text();
      const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/);
      if (!match?.[1]) return null;
      const fontRes = await fetch(match[1]);
      if (!fontRes.ok) return null;
      return fontRes.arrayBuffer();
    } catch {
      return null;
    }
  })();

  googleFontOnlyCache.set(cacheKey, promise);
  return promise;
}

type LocalFontFile = { weight: SatoriWeight; absPath: string };

function inferWeightFromFilename(fileBase: string): SatoriWeight {
  const s = fileBase.toLowerCase().replace(/italic/gi, '').trim();
  const num = s.match(/(?:^|[-_\s])([1-9]00)(?:[-_\s]|$)/);
  if (num) {
    const w = parseInt(num[1], 10) as SatoriWeight;
    if (w >= 100 && w <= 900) return w;
  }
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s) && !/extralight/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semibold|demi/.test(s)) return 600;
  if (/extrabold/.test(s)) return 800;
  if (/bold/.test(s)) return 700;
  if (/black|heavy/.test(s)) return 900;
  if (/regular|normal|roman|book/.test(s)) return 400;
  return 400;
}

function isItalicFilename(fileName: string): boolean {
  return /italic/i.test(fileName);
}

async function statDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function isPlaceholder(v: string): boolean {
  return !v || v.startsWith('%HANDOFF_');
}

let resolvedHandoffFontsDir: string | null | undefined;

/**
 * Locate the .handoff/{projectId}/public/fonts directory.
 * Uses env vars when available, falls back to scanning .handoff/ in cwd.
 */
async function findHandoffFontsDir(): Promise<string | null> {
  if (resolvedHandoffFontsDir !== undefined) return resolvedHandoffFontsDir;

  const modulePath = process.env.HANDOFF_MODULE_PATH ?? '';
  const projectId = process.env.HANDOFF_PROJECT_ID ?? '';

  if (!isPlaceholder(modulePath) && !isPlaceholder(projectId)) {
    const dir = path.join(modulePath, '.handoff', projectId, 'public', 'fonts');
    if (await statDir(dir)) {
      resolvedHandoffFontsDir = dir;
      return dir;
    }
  }

  const roots = [
    !isPlaceholder(modulePath) ? modulePath : null,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const handoffDir = path.join(root, '.handoff');
    if (!(await statDir(handoffDir))) continue;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(handoffDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const candidate = path.join(handoffDir, String(ent.name), 'public', 'fonts');
      if (await statDir(candidate)) {
        resolvedHandoffFontsDir = candidate;
        return candidate;
      }
    }
  }

  resolvedHandoffFontsDir = null;
  return null;
}

/**
 * Returns candidate font directories to scan, in priority order.
 * Each entry is { dir, mode } where mode "subfolder" means the dir IS the family folder
 * and "flat" means the dir contains files prefixed with the family name.
 */
async function localFontSearchPaths(family: string): Promise<{ dir: string; mode: 'subfolder' | 'flat' }[]> {
  const machineName = family.replace(/\s/g, '');
  const result: { dir: string; mode: 'subfolder' | 'flat' }[] = [];

  const fontsDir = await findHandoffFontsDir();
  if (fontsDir) {
    result.push({ dir: path.join(fontsDir, machineName), mode: 'subfolder' });
    result.push({ dir: fontsDir, mode: 'flat' });
  }

  const workingPath = process.env.HANDOFF_WORKING_PATH ?? '';
  if (!isPlaceholder(workingPath)) {
    const base = path.join(workingPath, 'fonts');
    result.push({ dir: path.join(base, machineName), mode: 'subfolder' });
    result.push({ dir: base, mode: 'flat' });
  }

  return result;
}

async function discoverLocalFontFiles(family: string): Promise<LocalFontFile[]> {
  const machineName = family.replace(/\s/g, '');
  const searchPaths = await localFontSearchPaths(family);
  console.log(`[foundation-image] discoverLocalFontFiles("${family}") searching ${searchPaths.length} paths:`, searchPaths.map((p) => `${p.dir} (${p.mode})`));
  for (const { dir, mode } of searchPaths) {
    const exists = await statDir(dir);
    if (!exists) {
      console.log(`[foundation-image]   skip ${dir} (not found)`);
      continue;
    }
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: LocalFontFile[] = [];
    for (const ent of dirents) {
      if (!ent.isFile()) continue;
      const fileName = String(ent.name);
      if (!/\.(ttf|otf)$/i.test(fileName)) continue;
      if (isItalicFilename(fileName)) continue;
      if (mode === 'flat') {
        const lower = fileName.toLowerCase();
        if (!lower.startsWith(machineName.toLowerCase())) continue;
      }
      const base = fileName.replace(/\.(ttf|otf)$/i, '');
      files.push({
        weight: inferWeightFromFilename(base),
        absPath: path.join(dir, fileName),
      });
    }
    if (files.length > 0) {
      console.log(`[foundation-image]   found ${files.length} font files for "${family}" in ${dir}:`, files.map((f) => `${path.basename(f.absPath)} → w${f.weight}`));
      return files;
    }
  }
  console.log(`[foundation-image]   NO local font files found for "${family}"`);
  return [];
}

function pickClosestWeightFile(files: LocalFontFile[], requested: SatoriWeight): LocalFontFile | null {
  if (files.length === 0) return null;
  const exact = files.find((f) => f.weight === requested);
  if (exact) return exact;
  return [...files].sort((a, b) => Math.abs(a.weight - requested) - Math.abs(b.weight - requested))[0] ?? null;
}

async function readLocalFontBuffer(family: string, weight: SatoriWeight): Promise<ArrayBuffer | null> {
  const files = await discoverLocalFontFiles(family);
  const pick = pickClosestWeightFile(files, weight);
  if (!pick) return null;
  try {
    const buf = await fs.readFile(pick.absPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
}

async function resolveFontBuffer(family: string, weight: SatoriWeight): Promise<ArrayBuffer | null> {
  const cacheKey = `resolved::${family}::${weight}`;
  if (resolvedFontCache.has(cacheKey)) return resolvedFontCache.get(cacheKey)!;

  const promise = (async (): Promise<ArrayBuffer | null> => {
    const local = await readLocalFontBuffer(family, weight);
    if (local) return local;
    return fetchGoogleFontTtf(family, weight);
  })();

  resolvedFontCache.set(cacheKey, promise);
  return promise;
}

const STYLE_TO_WEIGHT: Record<string, SatoriWeight> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

function styleToWeight(style: string): SatoriWeight {
  const trimmed = style.trim();
  const n = parseInt(trimmed, 10);
  if (!Number.isNaN(n) && n >= 100 && n <= 900 && n % 100 === 0) return n as SatoriWeight;
  const key = trimmed.toLowerCase().replace(/[\s-_]/g, '');
  return STYLE_TO_WEIGHT[key] ?? 400;
}

/**
 * Load Inter (always needed for UI labels) plus every unique font family
 * referenced by the typography tokens. Falls back gracefully if a family
 * isn't available on Google Fonts.
 */
async function loadFontsForContext(ctx: DesignWorkbenchFoundationContext): Promise<FontEntry[]> {
  const needed = new Map<string, Set<SatoriWeight>>();

  needed.set('Inter', new Set([400, 700]));

  for (const t of ctx.typography.slice(0, 14)) {
    const parsed = parseTypoLine(t.name, t.line);
    const family = parsed.fontFamily;
    if (!family || family === 'Sans-serif') continue;
    if (!needed.has(family)) needed.set(family, new Set());
    const w = styleToWeight(parsed.fontWeight);
    needed.get(family)!.add(w);
    if (!needed.get(family)!.has(400)) needed.get(family)!.add(400);
  }

  const jobs: { family: string; weight: SatoriWeight }[] = [];
  for (const [family, weights] of needed) {
    for (const w of weights) jobs.push({ family, weight: w });
  }

  console.log(`[foundation-image] loadFontsForContext: ${jobs.length} font jobs:`, jobs.map((j) => `${j.family}@${j.weight}`));

  const results = await Promise.all(jobs.map((j) => resolveFontBuffer(j.family, j.weight)));

  const fonts: FontEntry[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const data = results[i];
    const job = jobs[i];
    if (data) {
      console.log(`[foundation-image]   loaded "${job.family}" w${job.weight} (${data.byteLength} bytes)`);
      fonts.push({ name: job.family, data, weight: job.weight, style: 'normal' as const });
    } else if (job.family !== 'Inter') {
      console.warn(
        `[foundation-image] No font data for "${job.family}" weight ${job.weight}. ` +
          `Add TTF/OTF files under .handoff/<project>/public/fonts/${job.family.replace(/\s/g, '')}/ ` +
          `or HANDOFF_WORKING_PATH/fonts/${job.family.replace(/\s/g, '')}/, or use a Google Fonts family name.`
      );
    }
  }

  console.log(`[foundation-image] total fonts loaded: ${fonts.length} (${fonts.map((f) => `${f.name}@${f.weight}`).join(', ')})`);
  return fonts;
}

type ParsedTypo = {
  name: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  sizePx: number;
};

function parseTypoLine(name: string, line: string): ParsedTypo {
  const parts = line.split('·').map((s) => s.trim());
  const fontFamily = parts[0] || 'Sans-serif';
  const fontSize = parts[1] || '16px';
  const fontWeight = parts[2] || 'Regular';
  const lineHeight = parts[3] || '1.1';
  const sizePx = (() => {
    const m = fontSize.match(/(\d+)/);
    return m ? Math.min(Math.max(parseInt(m[1], 10), 10), 80) : 16;
  })();
  return { name, fontFamily, fontSize, fontWeight, lineHeight, sizePx };
}

function safeCssColor(value: string): string {
  const v = (value || '').trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(v)) return v;
  if (/^rgb(a)?\(/i.test(v)) return v;
  return '#E5E5E5';
}

function parseSpacingPx(value: string): number {
  const m = (value || '').match(/(\d+)\s*px/i);
  if (m) return Math.min(Math.max(parseInt(m[1], 10), 2), 320);
  const n = parseFloat(value);
  if (!Number.isNaN(n)) return Math.min(Math.max(Math.round(n), 2), 320);
  return 24;
}

export function shouldRasterizeFoundations(ctx: DesignWorkbenchFoundationContext): boolean {
  return (
    (ctx.colors?.length ?? 0) > 0 ||
    (ctx.typography?.length ?? 0) > 0 ||
    (ctx.spacing?.length ?? 0) > 0 ||
    (ctx.effects?.length ?? 0) > 0
  );
}

type ColorGroup = { groupName: string; swatches: { name: string; value: string; label: string }[] };

type WorkbenchColor = DesignWorkbenchFoundationContext['colors'][number];

/**
 * Group colors like /foundations/colors: primary `group` from Figma tokens, optional `subgroup` as swatch label.
 * Falls back to "Name/scale" parsing when `group` is absent (legacy tokens).
 */
function groupColors(colors: WorkbenchColor[]): ColorGroup[] {
  const hasExplicitGroup = colors.some((c) => (c.group ?? '').trim().length > 0);
  if (hasExplicitGroup) {
    const map = new Map<string, ColorGroup>();
    const order: string[] = [];
    for (const c of colors) {
      const groupName = (c.group ?? '').trim() || 'Colors';
      if (!map.has(groupName)) {
        map.set(groupName, { groupName, swatches: [] });
        order.push(groupName);
      }
      const label = (c.subgroup ?? '').trim() || c.name;
      map.get(groupName)!.swatches.push({ name: c.name, value: c.value, label });
    }
    return order.map((k) => map.get(k)!);
  }

  const map = new Map<string, ColorGroup>();
  const order: string[] = [];
  for (const c of colors) {
    const sepIdx = c.name.lastIndexOf('/');
    const groupName = sepIdx > 0 ? c.name.slice(0, sepIdx).trim() : c.name;
    const label = sepIdx > 0 ? c.name.slice(sepIdx + 1).trim() : '';
    if (!map.has(groupName)) {
      map.set(groupName, { groupName, swatches: [] });
      order.push(groupName);
    }
    map.get(groupName)!.swatches.push({ name: c.name, value: c.value, label });
  }
  return order.map((k) => map.get(k)!);
}

const SWATCH_W = 80;
const SWATCH_H = 56;
const SWATCHES_PER_ROW = 9;

function estimateHeight(ctx: DesignWorkbenchFoundationContext): number {
  let h = PAD + 36 + 24;
  const typoEntries = ctx.typography.slice(0, 14).map((t) => parseTypoLine(t.name, t.line));
  if (typoEntries.length > 0) {
    h += 36;
    for (const t of typoEntries) {
      const renderedSize = Math.min(t.sizePx, 64);
      const textWidth = WIDTH - PAD * 2 - 160 - 24;
      const charsPerLine = Math.max(Math.floor(textWidth / (renderedSize * 0.55)), 1);
      const sampleLen = t.sizePx >= 36 ? 19 : 48;
      const lines = Math.ceil(sampleLen / charsPerLine);
      h += Math.max(renderedSize * 1.15 * lines, 50) + 20;
    }
  }
  const groups = groupColors(ctx.colors.slice(0, 100));
  if (groups.length > 0) {
    h += 36;
    for (const g of groups) {
      const rows = Math.ceil(g.swatches.length / SWATCHES_PER_ROW);
      h += 24 + rows * (SWATCH_H + 30) + 12;
    }
  }
  const sp = Math.min(ctx.spacing?.length ?? 0, 20);
  if (sp) h += 28 + sp * 26;
  const fx = Math.min(ctx.effects?.length ?? 0, 12);
  if (fx) h += 28 + fx * 22;
  h += PAD + 80;
  return Math.min(Math.max(Math.ceil(h * 1.15), 520), 8000);
}

function FoundationsDoc({ ctx }: { ctx: DesignWorkbenchFoundationContext }) {
  const typoEntries = ctx.typography.slice(0, 14).map((t) => parseTypoLine(t.name, t.line));
  console.log('[foundation-image] FoundationsDoc typo entries:', typoEntries.map((t) => `"${t.name}" → family="${t.fontFamily}" weight="${t.fontWeight}" size=${t.sizePx}`));
  const colorGroups = groupColors(ctx.colors.slice(0, 100));
  const spacing = (ctx.spacing ?? []).slice(0, 20);
  const effects = (ctx.effects ?? []).slice(0, 12);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        backgroundColor: '#ffffff',
        color: '#111111',
        fontFamily: 'Inter',
        paddingLeft: PAD,
        paddingRight: PAD,
        paddingTop: PAD,
        paddingBottom: PAD,
      }}
    >
      {typoEntries.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 36 }}>
          {typoEntries.map((t, i) => (
            <div
              key={`ty-${i}`}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: 160,
                  paddingTop: 4,
                  fontSize: 10,
                  color: '#777777',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 11, color: '#333333' }}>{t.name}</div>
                <div style={{ display: 'flex', flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <span>{t.fontFamily}</span>
                  <span>·</span>
                  <span>{t.fontWeight}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
                  <span>{t.fontSize}</span>
                  <span>·</span>
                  <span>{t.lineHeight}</span>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: 1,
                  fontFamily: t.fontFamily !== 'Sans-serif' ? t.fontFamily : 'Inter',
                  fontSize: Math.min(t.sizePx, 64),
                  fontWeight: styleToWeight(t.fontWeight),
                  lineHeight: 1.15,
                  color: '#0C1116',
                  paddingLeft: 24,
                  alignItems: 'center',
                }}
              >
                {t.sizePx >= 36
                  ? 'Main heading sample'
                  : 'Almost before we knew it, we had left the ground.'}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {colorGroups.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 36 }}>
          {colorGroups.map((group, gi) => {
            const rows: typeof group.swatches[] = [];
            for (let i = 0; i < group.swatches.length; i += SWATCHES_PER_ROW) {
              rows.push(group.swatches.slice(i, i + SWATCHES_PER_ROW));
            }
            return (
              <div key={`cg-${gi}`} style={{ display: 'flex', flexDirection: 'column', marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#333333', marginBottom: 8 }}>{group.groupName}</div>
                {rows.map((row, ri) => (
                  <div key={`cr-${gi}-${ri}`} style={{ display: 'flex', flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                    {row.map((swatch, si) => (
                      <div
                        key={`cs-${gi}-${ri}-${si}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          width: SWATCH_W,
                        }}
                      >
                        <div
                          style={{
                            width: SWATCH_W,
                            height: SWATCH_H,
                            backgroundColor: safeCssColor(swatch.value),
                            borderRadius: 4,
                          }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 3 }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: '#333333' }}>{swatch.label || swatch.name}</div>
                          <div style={{ fontSize: 7, color: '#888888' }}>{swatch.value.toUpperCase()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

      {spacing.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, borderBottom: '1px solid #E5E5E5', paddingBottom: 6 }}>Spacing</div>
          {spacing.map((s, i) => {
            const w = parseSpacingPx(s.value);
            return (
              <div key={`sp-${i}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 12 }}>
                <div style={{ width: 160, fontSize: 10, color: '#444444' }}>{s.name}</div>
                <div style={{ fontSize: 9, color: '#666666', width: 120 }}>{s.value}</div>
                <div style={{ height: 10, width: w, backgroundColor: '#0077C8', borderRadius: 2 }} />
              </div>
            );
          })}
        </div>
      ) : null}

      {effects.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, borderBottom: '1px solid #E5E5E5', paddingBottom: 6 }}>Effects</div>
          {effects.map((e, i) => (
            <div key={`ef-${i}`} style={{ display: 'flex', flexDirection: 'row', fontSize: 10, color: '#333333', marginBottom: 6, lineHeight: 1.35 }}>
              <div style={{ fontWeight: 700, marginRight: 4 }}>{`${e.name}:`}</div>
              <div>{e.line}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rasterize foundation tokens into a PNG for vision models (e.g. GPT-image).
 * Returns null when there is nothing to render.
 */
export async function renderFoundationsImage(ctx: DesignWorkbenchFoundationContext): Promise<Buffer | null> {
  if (!shouldRasterizeFoundations(ctx)) return null;
  const height = estimateHeight(ctx);
  const fonts = await loadFontsForContext(ctx);
  const svg = await satori(<FoundationsDoc ctx={ctx} />, {
    width: WIDTH,
    height,
    fonts,
  });
  try {
    const resvg = new Resvg(svg, { font: { loadSystemFonts: false } });
    const png = resvg.render();
    return Buffer.from(png.asPng());
  } catch (err) {
    console.error('[foundation-image] resvg render failed, retrying with larger canvas:', err);
    const resvg = new Resvg(svg, {
      font: { loadSystemFonts: false },
      fitTo: { mode: 'width' as const, value: WIDTH },
    });
    const png = resvg.render();
    return Buffer.from(png.asPng());
  }
}
