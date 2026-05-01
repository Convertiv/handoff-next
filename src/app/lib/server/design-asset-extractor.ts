import {
  claimDesignArtifactForExtraction,
  finalizeDesignArtifactExtraction,
  getDesignArtifactById,
} from '@/lib/db/queries';
import { sanitizeDesignAssetsForStorage } from '@/lib/server/design-artifact-persist';
import { openAiChatJson, openAiImageEdit, type ImageEditInput } from '@/lib/server/ai-client';
import { imageUrlToVisionPart } from '@/lib/server/component-generation-images';

const ASSET_VISION_MODEL = () => process.env.HANDOFF_ASSET_VISION_MODEL?.trim() || 'gpt-4o-mini';

const MAX_DECOMPOSED_LAYERS = 5;

/** Layer plan from vision decomposition (before image edit). */
export type DecomposedLayer = {
  role: string;
  label: string;
  description: string;
  extract: boolean;
  usage: string;
  include: string[];
  exclude: string[];
  preserveFrame: boolean;
};

/** One extracted asset row stored on the artifact and passed to generation. */
export type ExtractedDesignAsset = {
  label: string;
  imageUrl: string;
  prompt: string;
  role?: string;
  usage?: string;
  description?: string;
  preserveFrame?: boolean;
};

function defaultFallbackLayers(): DecomposedLayer[] {
  return [
    {
      role: 'background',
      label: 'Background layer',
      description: 'Full-bleed background fill, gradients, and backdrop textures behind content',
      extract: true,
      usage: 'backgroundImage',
      include: [],
      exclude: ['text', 'buttons', 'foreground photography', 'UI chrome'],
      preserveFrame: true,
    },
    {
      role: 'foreground',
      label: 'Foreground subject',
      description: 'Main photographic subject or hero product as a separate layer',
      extract: true,
      usage: 'image',
      include: [],
      exclude: ['background', 'text', 'buttons'],
      preserveFrame: true,
    },
  ];
}

function parseDecomposeJson(raw: string): DecomposedLayer[] {
  try {
    const o = JSON.parse(raw) as { layers?: unknown };
    if (!Array.isArray(o.layers)) return [];
    const out: DecomposedLayer[] = [];
    for (const item of o.layers) {
      if (!item || typeof item !== 'object') continue;
      const L = item as Record<string, unknown>;
      const role = typeof L.role === 'string' ? L.role.trim() : 'foreground';
      if (role.toLowerCase() === 'ui') continue;
      if (L.extract === false) continue;
      const label = typeof L.label === 'string' && L.label.trim() ? L.label.trim() : `Layer ${out.length + 1}`;
      out.push({
        role,
        label,
        description: typeof L.description === 'string' ? L.description.trim() : '',
        extract: L.extract !== false,
        usage: typeof L.usage === 'string' ? L.usage.trim() : '',
        include: Array.isArray(L.include) ? L.include.filter((x): x is string => typeof x === 'string') : [],
        exclude: Array.isArray(L.exclude) ? L.exclude.filter((x): x is string => typeof x === 'string') : [],
        preserveFrame: L.preserveFrame === true,
      });
      if (out.length >= MAX_DECOMPOSED_LAYERS) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function decomposeDesignIntoLayers(imageUrl: string, actorUserId: string | null): Promise<DecomposedLayer[]> {
  const part = await imageUrlToVisionPart(imageUrl, 'low');
  if (!part) return defaultFallbackLayers();

  const system = `You are preparing raster assets to rebuild a UI or marketing screenshot as a web component.

Identify ONLY visual layers that should become separate image files in code (e.g. background texture, hero photo, logo bitmap, decorative illustration).

Do NOT list as extractable layers: plain text, headings, breadcrumbs, buttons, CTAs, layout boxes, icons that should be SVG/CSS, or anything that should be implemented as HTML/CSS instead of a bitmap.

Return JSON only with this exact shape:
{"layers":[{"role":"background|foreground|decorative|media|logo|icon","label":"short developer label","description":"what this bitmap contains","extract":true,"usage":"backgroundImage|image|logo|icon|","include":["optional specifics to keep"],"exclude":["optional specifics to remove"],"preserveFrame":true}]}

Rules:
- At most ${MAX_DECOMPOSED_LAYERS} entries with "extract": true.
- Order layers back-to-front when stacking matters (background first).
- "preserveFrame": true when the crop/masking in the design should be preserved for implementation (e.g. rounded image card).
- "usage" hints how Handoff properties might map: backgroundImage vs image vs logo.`;

  try {
    const raw = await openAiChatJson(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Decompose this design into code-relevant image layers:' }, part],
        },
      ],
      {
        actorUserId,
        route: 'design-asset-extract',
        eventType: 'ai.design_asset_decompose',
        model: ASSET_VISION_MODEL(),
        maxTokens: 1200,
      }
    );
    const parsed = parseDecomposeJson(raw);
    return parsed.length > 0 ? parsed : defaultFallbackLayers();
  } catch (e) {
    console.warn('[design-asset-extractor] decompose failed, using fallback layers:', e);
    return defaultFallbackLayers();
  }
}

function buildImageEditPromptFromLayer(layer: DecomposedLayer): string {
  const desc = layer.description || layer.label;
  const inc = layer.include.length ? layer.include.join('; ') : '';
  const exc = layer.exclude.length ? layer.exclude.join('; ') : '';
  const frame = layer.preserveFrame
    ? 'Preserve the framing, crop, and rounded corners as they appear in the original composition.'
    : '';

  const role = layer.role.toLowerCase();

  if (role === 'background') {
    return `Extract ONE reusable background bitmap for web code from this composition.

Target layer: ${desc}
${inc ? `Must include: ${inc}` : 'Include: background fill, gradients, textures, and decorative backdrop patterns that sit behind foreground content.'}
${exc ? `Must remove: ${exc}` : 'Remove: all text, buttons, links, icons, UI chrome, and separate foreground photography or product cards that belong in their own asset.'}
${frame}
Do not invent scenery, charts, or objects not visible in the original. Preserve aspect ratio. Output a single image suitable as CSS background-image.`;
  }

  if (role === 'decorative') {
    return `Extract ONE reusable decorative bitmap (illustration, pattern, or non-photo graphic) for web code.

Target layer: ${desc}
${inc ? `Must include: ${inc}` : 'Include only the decorative graphic elements described.'}
${exc ? `Must remove: ${exc}` : 'Remove: text, buttons, unrelated photography, and large background fills not part of this graphic.'}
${frame}
Do not invent new shapes. Preserve aspect ratio.`;
  }

  if (role === 'logo' || role === 'icon') {
    return `Extract ONE small reusable bitmap for web code (${role}).

Target layer: ${desc}
${inc ? `Must include: ${inc}` : ''}
${exc ? `Must remove: ${exc}` : 'Remove surrounding layout, text, and unrelated imagery.'}
Prefer clean edges and transparent background where appropriate. Do not invent marks not in the original. Preserve aspect ratio.`;
  }

  // foreground, media, or unknown — generic “hero asset” extraction
  return `Extract ONE reusable raster asset for web code from this composition.

Target layer: ${desc}
${inc ? `Must include: ${inc}` : 'Include: the subject or media region as it appears in the design (same crop and treatment).'}
${exc ? `Must remove: ${exc}` : 'Remove: unrelated background, text, buttons, and UI chrome not part of this layer.'}
${frame}
For photographic subjects prefer a transparent or neutral cutout where appropriate. Do not invent people, products, or screens. Preserve aspect ratio.`;
}

function parseValidationJson(raw: string): { ok: boolean; explanation: string } {
  try {
    const o = JSON.parse(raw) as { ok?: unknown; present?: unknown; matchesRole?: unknown; explanation?: unknown };
    const expl = typeof o.explanation === 'string' ? o.explanation : '';
    if (typeof o.ok === 'boolean') return { ok: o.ok, explanation: expl };
    const present = o.present === true;
    const roleOk = o.matchesRole !== false && o.matchesRole !== undefined ? o.matchesRole === true : true;
    if (typeof o.present === 'boolean' && typeof o.matchesRole === 'boolean') {
      return { ok: present && roleOk, explanation: expl };
    }
    if (typeof o.present === 'boolean') return { ok: present, explanation: expl };
    return { ok: true, explanation: expl || 'invalid JSON from validator' };
  } catch {
    return { ok: true, explanation: 'invalid JSON from validator' };
  }
}

function parseLabelJson(raw: string): string {
  try {
    const o = JSON.parse(raw) as { label?: unknown };
    const s = typeof o.label === 'string' ? o.label.trim() : '';
    return s ? s.slice(0, 120) : '';
  } catch {
    return '';
  }
}

/** Vision gate: grounded in original AND matches intended layer role. */
async function visionAssetPresentAndRoleMatch(
  originalImageUrl: string,
  assetImageUrl: string,
  layer: Pick<DecomposedLayer, 'role' | 'label' | 'description' | 'usage'>,
  actorUserId: string | null
): Promise<{ ok: boolean; explanation: string }> {
  const orig = await imageUrlToVisionPart(originalImageUrl, 'low');
  const asset = await imageUrlToVisionPart(assetImageUrl, 'low');
  if (!orig || !asset) {
    return { ok: true, explanation: 'vision load failed; skipped strict check' };
  }

  const intent = `Intended layer role="${layer.role}" label="${layer.label}" usage="${layer.usage}" description="${layer.description || ''}"`;

  const raw = await openAiChatJson(
    [
      {
        role: 'system',
        content: `You compare two images. Image A is the ORIGINAL design. Image B is an EXTRACTED asset candidate.

Reply with JSON only: {"ok":true|false,"explanation":"one sentence"}.

Set ok to true only if ALL hold:
1) B is grounded in A (no invented charts, dashboards, people, or objects not visible in A).
2) B matches the extraction intent below (right kind of layer — e.g. background should not wrongly include a separate hero photo if that photo is its own layer).

${intent}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Image A — ORIGINAL:' },
          orig,
          { type: 'text', text: 'Image B — EXTRACTED candidate:' },
          asset,
        ],
      },
    ],
    {
      actorUserId,
      route: 'design-asset-extract',
      eventType: 'ai.design_asset_validate',
      model: ASSET_VISION_MODEL(),
      maxTokens: 280,
    }
  );

  return parseValidationJson(raw);
}

async function visionDescribeAsset(assetImageUrl: string, actorUserId: string | null): Promise<string> {
  const asset = await imageUrlToVisionPart(assetImageUrl, 'low');
  if (!asset) return '';

  const raw = await openAiChatJson(
    [
      {
        role: 'system',
        content:
          'Describe the main subject of this image in 2–8 words for a developer-facing asset label. JSON only: {"label":"..."}. Examples: "woman working at laptop", "blue gradient background", "product hero bottle".',
      },
      { role: 'user', content: [{ type: 'text', text: 'Asset to label:' }, asset] },
    ],
    {
      actorUserId,
      route: 'design-asset-extract',
      eventType: 'ai.design_asset_label',
      model: ASSET_VISION_MODEL(),
      maxTokens: 120,
    }
  );

  return parseLabelJson(raw);
}

export async function imageUrlToEditInput(imageUrl: string): Promise<ImageEditInput | null> {
  const trimmed = imageUrl.trim();
  const dataMatch = /^data:(image\/(?:png|jpeg|webp|jpg));base64,(.+)$/i.exec(trimmed);
  if (dataMatch) {
    let mime = dataMatch[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null;
    const buf = Buffer.from(dataMatch[2], 'base64');
    if (buf.length === 0) return null;
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    return {
      filename: `composite.${ext}`,
      contentType: mime as ImageEditInput['contentType'],
      data: buf,
    };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let contentType: ImageEditInput['contentType'] | null = null;
    if (ct === 'image/png') contentType = 'image/png';
    else if (ct === 'image/jpeg' || ct === 'image/jpg') contentType = 'image/jpeg';
    else if (ct === 'image/webp') contentType = 'image/webp';
    if (!contentType) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { filename: 'composite.png', contentType, data: buf };
  }
  return null;
}

export type ExtractDesignAssetsResult = {
  assets: unknown[];
  assetsStatus: 'done' | 'failed';
  extractionError: string | null;
};

/**
 * Run gpt-image-2 isolation edits on a composite image (no DB). Used by worker and cloud extract API.
 */
export async function extractDesignAssetsFromCompositeImage(params: {
  imageUrl: string;
  actorUserId: string | null;
}): Promise<ExtractDesignAssetsResult> {
  const { imageUrl, actorUserId } = params;
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return {
      assets: [],
      assetsStatus: 'failed',
      extractionError: 'HANDOFF_AI_API_KEY is not configured.',
    };
  }

  try {
    const input = await imageUrlToEditInput(imageUrl);
    if (!input) {
      return {
        assets: [],
        assetsStatus: 'failed',
        extractionError: 'Could not read composite image (need data URL or http image).',
      };
    }

    const editOpts = {
      model: 'gpt-image-2' as const,
      size: '1024x1024' as const,
      actorUserId,
      route: 'worker:design-asset',
    };

    const layers = await decomposeDesignIntoLayers(imageUrl, actorUserId);
    const rawAssets: ExtractedDesignAsset[] = [];
    const extractionErrors: string[] = [];

    for (const layer of layers) {
      if (!layer.extract) continue;
      const prompt = buildImageEditPromptFromLayer(layer);
      const safeRole = layer.role.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'layer';
      try {
        const imageUrlOut = await openAiImageEdit({
          ...editOpts,
          prompt,
          images: [input],
          eventType: `ai.design_asset_extract.${safeRole}`,
        });
        rawAssets.push({
          label: layer.label,
          imageUrl: imageUrlOut,
          prompt,
          role: layer.role,
          usage: layer.usage,
          description: layer.description,
          preserveFrame: layer.preserveFrame,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[design-asset-extractor] layer extraction failed:', layer.role, msg);
        extractionErrors.push(`${layer.label}: ${msg}`);
      }
    }

    if (rawAssets.length === 0) {
      return {
        assets: [],
        assetsStatus: 'failed',
        extractionError: extractionErrors.join(' | ').slice(0, 2000) || 'No layers extracted.',
      };
    }

    const vetted: ExtractedDesignAsset[] = [];
    for (const a of rawAssets) {
      const layerMeta: Pick<DecomposedLayer, 'role' | 'label' | 'description' | 'usage'> = {
        role: a.role ?? 'foreground',
        label: a.label,
        description: a.description ?? '',
        usage: a.usage ?? '',
      };
      try {
        const v = await visionAssetPresentAndRoleMatch(imageUrl, a.imageUrl, layerMeta, actorUserId);
        if (!v.ok) {
          console.warn('[design-asset-extractor] discarded asset (validation):', a.label, v.explanation);
          continue;
        }
      } catch (e) {
        console.warn('[design-asset-extractor] validation failed (keeping asset):', e);
      }

      let label = a.label;
      try {
        const described = await visionDescribeAsset(a.imageUrl, actorUserId);
        if (described) label = described;
      } catch {
        /* keep default label */
      }
      vetted.push({
        ...a,
        label,
      });
    }

    if (vetted.length === 0) {
      return {
        assets: [],
        assetsStatus: 'failed',
        extractionError: 'All extracted assets failed vision validation (possible model mismatch or strict gate).',
      };
    }

    const assets = sanitizeDesignAssetsForStorage(vetted) as unknown[];
    return { assets, assetsStatus: 'done', extractionError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      assets: [],
      assetsStatus: 'failed',
      extractionError: msg.slice(0, 2000),
    };
  }
}

/**
 * Background worker entry: claim pending row, run gpt-image-2 isolation edit, persist assets.
 */
export async function runDesignAssetExtractionForArtifact(artifactId: string): Promise<void> {
  const claimed = await claimDesignArtifactForExtraction(artifactId);
  if (!claimed) {
    console.log('[design-asset-extractor] skip (not pending or already claimed)', artifactId);
    return;
  }

  const row = await getDesignArtifactById(artifactId);
  if (!row?.imageUrl?.trim()) {
    await finalizeDesignArtifactExtraction(artifactId, {
      assets: [],
      assetsStatus: 'failed',
      extractionError: 'No composite image on artifact.',
    });
    return;
  }

  const result = await extractDesignAssetsFromCompositeImage({
    imageUrl: row.imageUrl,
    actorUserId: row.userId,
  });

  await finalizeDesignArtifactExtraction(artifactId, {
    assets: result.assets,
    assetsStatus: result.assetsStatus,
    extractionError: result.extractionError,
  });
}
