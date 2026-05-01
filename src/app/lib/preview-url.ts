/**
 * Basenames only: Handoff serves previews at `/api/component/{basename}.html`.
 * Rejects path traversal, query strings, and non-HTML suffixes.
 */
const SAFE_PREVIEW_HTML = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html$/;

/** Returns the basename if safe, otherwise null. */
export function sanitizePreviewUrlForOpen(url: string | null | undefined): string | null {
  if (url == null || typeof url !== 'string') return null;
  const s = url.trim();
  if (!s) return null;
  if (s.includes('/') || s.includes('\\') || s.includes('..') || s.includes('?') || s.includes('#')) return null;
  if (!SAFE_PREVIEW_HTML.test(s)) return null;
  return s;
}
