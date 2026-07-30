import 'server-only';

import { parse } from 'node-html-parser';
import { normalizeUrl } from '@/lib/url-safety';

/**
 * Pull the readable content out of a public web page: headings, copy, and image URLs.
 *
 * Server-side deliberately. The old `PageImporter` fetched from the **browser through third-party CORS
 * proxies** (`allorigins.win`, `corsproxy.io`) — which routes whatever page the user is looking at, and
 * its contents, through a stranger's server, and breaks whenever those proxies do. Same class of
 * problem as the browser-held API key it sat next to.
 *
 * The output is conversation input, not a composition. It gives the chat something concrete to work
 * from — real headings, real copy, the images that exist — and the model then chooses blocks and writes
 * args the same way it would from a typed brief. Mapping scraped HTML straight onto blocks was the old
 * approach and it guessed structure that was never really there.
 */

export { normalizeUrl };

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  /** Headings in document order, with their level, so the model can infer sections. */
  headings: { level: number; text: string }[];
  /** Substantive paragraphs. Boilerplate and nav crumbs are dropped. */
  paragraphs: string[];
  /** Absolute image URLs found in the main content. */
  images: { src: string; alt: string }[];
}

/** Wrappers that usually hold the real content, best-first. */
const CONTENT_SELECTORS = ['main', 'article', '[role="main"]', '#content', '.content'];

/** Chrome that is never page content. */
const STRIP = ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'svg', 'iframe', 'form'];

/** Below this, a "paragraph" is a label, a crumb, or a cookie notice — not copy. */
const MIN_PARAGRAPH = 40;

const CAP = { headings: 40, paragraphs: 60, images: 30 };

function absolutize(src: string, base: string): string {
  if (!src) return '';
  try {
    return new URL(src, base).href;
  } catch {
    return '';
  }
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export async function extractPage(rawUrl: string, opts: { timeoutMs?: number } = {}): Promise<ExtractedPage> {
  const url = normalizeUrl(rawUrl);

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Some sites serve a JS shell to unknown agents. Identify honestly and accept HTML.
      'User-Agent': 'HandoffBot/1.0 (+design-system content import)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`Could not fetch that page (${res.status}).`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html')) throw new Error(`That URL returned ${contentType || 'a non-HTML response'}.`);

  const html = await res.text();
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });

  const title = clean(root.querySelector('title')?.textContent ?? '');
  const description = clean(
    root.querySelector('meta[name="description"]')?.getAttribute('content') ??
      root.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
      ''
  );

  for (const sel of STRIP) root.querySelectorAll(sel).forEach((n) => n.remove());

  const main = CONTENT_SELECTORS.map((sel) => root.querySelector(sel)).find(Boolean) ?? root;

  const headings = main
    .querySelectorAll('h1, h2, h3, h4')
    .map((h) => ({ level: Number(h.tagName.slice(1)) || 2, text: clean(h.textContent) }))
    .filter((h) => h.text)
    .slice(0, CAP.headings);

  const seenParagraph = new Set<string>();
  const paragraphs: string[] = [];
  for (const p of main.querySelectorAll('p, li')) {
    const text = clean(p.textContent);
    // Dedupe: repeated marketing lines and nav labels otherwise dominate the output.
    if (text.length < MIN_PARAGRAPH || seenParagraph.has(text)) continue;
    seenParagraph.add(text);
    paragraphs.push(text);
    if (paragraphs.length >= CAP.paragraphs) break;
  }

  const seenImage = new Set<string>();
  const images: { src: string; alt: string }[] = [];
  for (const img of main.querySelectorAll('img')) {
    // `src` is often a placeholder on lazy-loaded pages; the real one hides in a data attribute.
    const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
    const src = absolutize(raw, url);
    if (!src || seenImage.has(src) || src.startsWith('data:')) continue;
    seenImage.add(src);
    images.push({ src, alt: clean(img.getAttribute('alt') ?? '') });
    if (images.length >= CAP.images) break;
  }

  return { url, title, description, headings, paragraphs, images };
}
