import 'server-only';

/** Final image is stored in `image_url`; assistant turns often repeat the same huge data URL — drop it to avoid oversized rows / requests. */
export function sanitizeConversationHistoryForStorage(history: unknown): unknown {
  if (!Array.isArray(history)) return [];
  return history.map((turn) => {
    if (!turn || typeof turn !== 'object') return turn;
    const o = { ...(turn as Record<string, unknown>) };
    const iu = o.imageUrl;
    if (typeof iu === 'string' && iu.startsWith('data:image/')) {
      delete o.imageUrl;
      o.imageOmitted = true;
    }
    return o;
  });
}

const MAX_SOURCE_DATA_URL_CHARS = 800_000;
const MAX_ASSET_IMAGE_URL_CHARS = 10_000_000;

/** Cap each bench reference so several uploads + main image stay under typical proxy limits. */
export function sanitizeSourceImagesForStorage(images: unknown): unknown {
  if (!Array.isArray(images)) return [];
  return images.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    const d = o.dataUrl;
    if (typeof d === 'string' && d.length > MAX_SOURCE_DATA_URL_CHARS) {
      o.dataUrl = `${d.slice(0, MAX_SOURCE_DATA_URL_CHARS)}…[truncated]`;
      o.truncated = true;
    }
    return o;
  });
}

/** Cap stored extraction output per asset to avoid oversized rows. */
export function sanitizeDesignAssetsForStorage(assets: unknown): unknown {
  if (!Array.isArray(assets)) return [];
  return assets.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    const iu = o.imageUrl;
    if (typeof iu === 'string' && iu.length > MAX_ASSET_IMAGE_URL_CHARS) {
      o.imageUrl = `${iu.slice(0, MAX_ASSET_IMAGE_URL_CHARS)}…[truncated]`;
      o.truncated = true;
    }
    return o;
  });
}
