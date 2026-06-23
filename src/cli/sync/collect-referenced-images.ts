import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import type Handoff from '@handoff/index';

/**
 * A workspace image referenced by a component's artifacts/source, resolved to
 * real bytes and assigned a content-addressed asset id. Pushed to the registry
 * where it becomes a library asset and the reference is rewritten to its URL.
 */
export type ReferencedImage = {
  /** Content-addressed: `img_<sha256[:12]>` — stable + dedupes across components. */
  assetId: string;
  /** Original basename, used as the asset title (e.g. 'iframe-bg-img.jpeg'). */
  filename: string;
  contentHash: string;
  mime: string;
  /** Base64-encoded bytes. */
  dataBase64: string;
  /** Original reference strings that were rewritten to this asset's URL. */
  refs: string[];
};

export type CollectReferencedImagesResult = {
  images: ReferencedImage[];
  /** originalRef → served asset URL, for rewriting artifact text. */
  rewriteMap: Record<string, string>;
  /** Human-readable notices (e.g. images skipped for being oversized). */
  warnings: string[];
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

// Images are now pushed via a dedicated per-image endpoint rather than bundled
// with the component payload. Cap at 4MB to stay within Vercel's request limit
// for any single image. Images larger than this are skipped with a warning.
const MAX_IMAGE_BYTES = 4_000_000;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** Served URL for a DB-backed asset (root-relative; previews are same-origin). */
function assetUrl(assetId: string): string {
  return `/api/handoff/assets/${assetId}/raw`;
}

/**
 * Pull candidate image reference strings out of artifact/source text:
 *  - JS/TS/HTML string literals ending in an image extension
 *  - CSS/SCSS url(...) values
 * Returns the raw reference exactly as it appears (so we can string-replace it).
 */
function extractRefs(text: string): Set<string> {
  const refs = new Set<string>();

  // Quoted string literals (single, double, backtick) ending in an image ext.
  const quoted = /["'`]([^"'`\n]+?\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?[^"'`\n]*)?)["'`]/gi;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(text)) !== null) refs.add(m[1]);

  // CSS url(...) — may be unquoted.
  const cssUrl = /url\(\s*['"]?([^'")]+?\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?[^'")]*)?)['"]?\s*\)/gi;
  while ((m = cssUrl.exec(text)) !== null) refs.add(m[1]);

  return refs;
}

/** Strip query/hash and leading ./ ../ segments to get a workspace-relative tail. */
function refToTail(ref: string): string {
  const clean = ref.split(/[?#]/)[0];
  return clean.replace(/^(?:\.\.?\/)+/, '').replace(/^\/+/, '');
}

/** Skip refs that are already absolute URLs or registry-served paths. */
function isExternalOrServed(ref: string): boolean {
  return (
    /^https?:\/\//i.test(ref) ||
    ref.startsWith('data:') ||
    ref.startsWith('/api/') ||
    ref.startsWith('/fonts/')
  );
}

async function resolveRefToFile(handoff: Handoff, ref: string): Promise<string | null> {
  const tail = refToTail(ref);
  if (!tail) return null;
  const roots = [path.join(handoff.workingPath, 'public'), handoff.workingPath];
  // Bootstrap/Handlebars projects (e.g. SS&C) keep component assets under an
  // 'integration/' directory alongside their component source files rather than
  // under 'public/'. Add it as a fallback root when the directory exists so
  // image refs like /images/content/hero.jpg resolve correctly.
  const integrationDir = path.join(handoff.workingPath, 'integration');
  if (await fs.pathExists(integrationDir)) roots.push(integrationDir);
  for (const root of roots) {
    const candidate = path.join(root, tail);
    // Guard against path traversal escaping the root.
    if (!candidate.startsWith(root)) continue;
    if (await fs.pathExists(candidate)) {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    }
  }
  return null;
}

/**
 * Scan a component's collected artifact text and source files for referenced
 * workspace images, resolve them to bytes, and build a rewrite map from the
 * original reference to the asset's served URL.
 */
export async function collectReferencedImages(
  handoff: Handoff,
  artifactTexts: string[],
  sourceFiles: Record<string, string>
): Promise<CollectReferencedImagesResult> {
  const allRefs = new Set<string>();
  for (const text of artifactTexts) {
    if (typeof text === 'string') for (const r of extractRefs(text)) allRefs.add(r);
  }
  for (const content of Object.values(sourceFiles)) {
    if (typeof content === 'string') for (const r of extractRefs(content)) allRefs.add(r);
  }

  // Group refs by resolved file so multiple references to the same image
  // (e.g. .woff + .woff2-style variants, or the same path quoted differently)
  // collapse to one content-addressed asset.
  const byFile = new Map<string, { refs: Set<string>; abs: string }>();
  for (const ref of allRefs) {
    if (isExternalOrServed(ref)) continue;
    const abs = await resolveRefToFile(handoff, ref);
    if (!abs) continue;
    if (!byFile.has(abs)) byFile.set(abs, { refs: new Set(), abs });
    byFile.get(abs)!.refs.add(ref);
  }

  const images: ReferencedImage[] = [];
  const rewriteMap: Record<string, string> = {};
  const warnings: string[] = [];

  for (const { abs, refs } of byFile.values()) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      continue;
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      // Skip: too large to ride on the component push payload. Leave the
      // reference unrewritten (it will not resolve on the registry) and flag it.
      warnings.push(
        `Skipped oversized image "${path.basename(abs)}" (${Math.round(buf.length / 1024)}KB > ${Math.round(MAX_IMAGE_BYTES / 1024)}KB limit per image) — its reference was left as-is and will not resolve on the registry.`
      );
      continue;
    }
    const contentHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const assetId = `img_${contentHash}`;
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const url = assetUrl(assetId);

    images.push({
      assetId,
      filename: path.basename(abs),
      contentHash,
      mime,
      dataBase64: buf.toString('base64'),
      refs: Array.from(refs),
    });
    for (const ref of refs) rewriteMap[ref] = url;
  }

  return { images, rewriteMap, warnings };
}

/** Apply a rewrite map to artifact text, replacing every original ref string. */
export function applyImageRewrites(text: string, rewriteMap: Record<string, string>): string {
  if (!text) return text;
  let out = text;
  for (const [ref, url] of Object.entries(rewriteMap)) {
    if (!ref || ref === url) continue;
    out = out.split(ref).join(url);
  }
  return out;
}
