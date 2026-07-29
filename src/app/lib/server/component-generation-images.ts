import 'server-only';

import type { ImageContent } from '@/lib/server/ai-client';
import { blobPathnameFromProxyUrl, readPrivateBlob } from '@/lib/storage/artifact-images';

/**
 * Resolve design / asset URLs to OpenAI vision image_url parts (data URLs).
 * @param detail — 'high' for full-resolution analysis (default), 'low' for thumbnails
 */
export async function imageUrlToVisionPart(url: string, detail: 'high' | 'low' = 'high'): Promise<ImageContent | null> {
  const t = url.trim();
  if (!t) return null;
  if (t.startsWith('data:image/')) {
    return { type: 'image_url', image_url: { url: t, detail } };
  }
  // Artifact images live in a PRIVATE Blob store and are persisted as proxy URLs, which are not
  // fetchable over plain HTTP. Read them through the SDK instead of going out over the network —
  // this also avoids the proxy route's auth check, which exists for browsers, not for ourselves.
  const blobPath = blobPathnameFromProxyUrl(t);
  if (blobPath) {
    const read = await readPrivateBlob(blobPath);
    if (!read) return null;
    const mime = read.contentType.startsWith('image/') ? read.contentType : 'image/png';
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${read.buffer.toString('base64')}`, detail } };
  }
  if (t.startsWith('http://') || t.startsWith('https://')) {
    try {
      const res = await fetch(t, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const b64 = Buffer.from(ab).toString('base64');
      const ct = (res.headers.get('content-type') || 'image/png').split(';')[0]!.trim().toLowerCase();
      const mime = ct.startsWith('image/') ? ct : 'image/png';
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail } };
    } catch {
      return null;
    }
  }
  return null;
}
