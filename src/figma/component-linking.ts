import { Providers, Types as CoreTypes } from 'handoff-core';
import type Handoff from '@handoff/index';
import { slugify } from '@handoff/transformers/utils/string';

export type FigmaMatchStatus = 'matched' | 'missing_in_handoff' | 'missing_in_figma' | 'ambiguous' | 'unlinked';
export type FigmaMatchedBy = 'component_key' | 'figma_component_id' | 'runtime_id' | null;

export type FigmaVariantSchemaProperty = {
  name: string;
  values: string[];
  defaultValue?: string;
};

export type FigmaImageAsset = {
  name: string;
  role?: string;
  imageRef?: string;
  url?: string;
  width?: number;
  height?: number;
  nodeId?: string;
  part?: string;
};

export type FigmaComponentLinkData = {
  figma?: string;
  figmaComponentId?: string;
  figmaComponentKey?: string;
  figmaPublishedComponentKeys?: string[];
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaComponentSetId?: string;
  figmaComponentSetName?: string;
  figmaComponentName?: string;
  figmaDescription?: string;
  figmaThumbnailUrl?: string;
  figmaUpdatedAt?: string;
  figmaVariantSchema?: FigmaVariantSchemaProperty[];
  figmaVariantLabel?: string;
  figmaVariantValues?: Record<string, string>;
  figmaInstanceCount?: number;
  figmaImages?: FigmaImageAsset[];
  figmaMatchStatus?: FigmaMatchStatus;
  figmaMatchedBy?: Exclude<FigmaMatchedBy, null>;
  figmaMissingMetadata?: string[];
};

export function buildFigmaUrl(fileKey?: string, nodeId?: string): string | undefined {
  if (!fileKey || !nodeId) return undefined;
  return `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}`;
}

/** Flat {@link FigmaComponentLinkData} fields nested as `figma: { url?, ... }` in `.handoff.ts` / JSON (excludes top-level `figma` URL — that becomes `figma.url`). */
export const FIGMA_LINK_NESTABLE_KEYS: readonly (keyof Omit<FigmaComponentLinkData, 'figma'>)[] = [
  'figmaComponentId',
  'figmaComponentKey',
  'figmaPublishedComponentKeys',
  'figmaFileKey',
  'figmaNodeId',
  'figmaComponentSetId',
  'figmaComponentSetName',
  'figmaComponentName',
  'figmaDescription',
  'figmaThumbnailUrl',
  'figmaUpdatedAt',
  'figmaVariantSchema',
  'figmaVariantLabel',
  'figmaVariantValues',
  'figmaInstanceCount',
  'figmaImages',
  'figmaMatchStatus',
  'figmaMatchedBy',
  'figmaMissingMetadata',
] as const;

/**
 * If `declaration.figma` is an object (nested sync metadata), merge onto the flat shape
 * the rest of Handoff expects. Idempotent when `figma` is already a string URL.
 */
export function flattenNestedFigmaInRawDeclaration<T extends Record<string, unknown>>(raw: T): T {
  const fig = raw.figma;
  if (!fig || typeof fig !== 'object' || Array.isArray(fig)) {
    return raw;
  }
  const block = fig as Record<string, unknown>;
  const next: Record<string, unknown> = { ...raw };
  delete next.figma;

  for (const key of FIGMA_LINK_NESTABLE_KEYS) {
    const v = block[key as string];
    if (v !== undefined && next[key as string] === undefined) {
      next[key as string] = v;
    }
  }

  const url = typeof block.url === 'string' ? block.url : undefined;
  if (url) {
    next.figma = url;
  } else if (!next.figma) {
    const fk = block.figmaFileKey;
    const nid = block.figmaNodeId;
    if (typeof fk === 'string' && typeof nid === 'string') {
      const built = buildFigmaUrl(fk, nid);
      if (built) next.figma = built;
    }
  }

  return next as T;
}

/** Inverse of {@link flattenNestedFigmaInRawDeclaration} for writing declaration JSON files. */
export function nestFigmaLinkDataForDeclarationFile<T extends Record<string, unknown>>(flat: T): T {
  const out: Record<string, unknown> = { ...flat };
  const block: Record<string, unknown> = {};

  if (typeof flat.figma === 'string' && flat.figma.trim()) {
    block.url = flat.figma;
  }

  for (const key of FIGMA_LINK_NESTABLE_KEYS) {
    const v = flat[key as string];
    if (v !== undefined) {
      block[key as string] = v;
    }
  }

  for (const key of FIGMA_LINK_NESTABLE_KEYS) {
    delete out[key];
  }
  delete out.figma;

  if (Object.keys(block).length > 0) {
    out.figma = block;
  } else if (typeof flat.figma === 'string' && flat.figma.trim()) {
    out.figma = flat.figma;
  }

  return out as T;
}

export type FigmaPreviewSeed = {
  id: string;
  title: string;
  values: Record<string, string>;
};

export type FigmaNodePropertySeed = {
  key: string;
  name: string;
  suggestedType: 'text' | 'image';
  nodePath: string;
  defaultValue?: unknown;
  width?: number;
  height?: number;
};

export type FigmaComponentCatalogEntry = FigmaComponentLinkData & {
  slug: string;
  figmaComponentName: string;
  previews: FigmaPreviewSeed[];
  children: FigmaChildComponentCatalogEntry[];
};

export type FigmaComponentCatalog = {
  entries: FigmaComponentCatalogEntry[];
  childEntries: FigmaChildComponentCatalogEntry[];
  byName: Map<string, FigmaComponentCatalogEntry>;
  byComponentKey: Map<string, FigmaChildComponentCatalogEntry>;
  byChildName: Map<string, FigmaChildComponentCatalogEntry[]>;
};

export type HandoffFigmaMatch = {
  status: FigmaMatchStatus;
  matchedBy: FigmaMatchedBy;
  entry?: FigmaComponentCatalogEntry;
  child?: FigmaChildComponentCatalogEntry;
};

export type FigmaChildComponentCatalogEntry = FigmaComponentLinkData & {
  slug: string;
  parentSlug: string;
  figmaComponentName: string;
  figmaComponentKey: string;
  figmaNodeId: string;
  previews: FigmaPreviewSeed[];
};

export type FigmaAuditComponentEntry = {
  id: string;
  title: string;
  status: FigmaMatchStatus;
  matchedBy: FigmaMatchedBy;
  figmaComponentId?: string;
  figmaComponentKey?: string;
  matchedFigmaComponentName?: string;
  missingMetadata: string[];
};

export type FigmaAuditReport = {
  generatedAt: string;
  summary: {
    figmaComponents: number;
    handoffComponents: number;
    matched: number;
    unlinked: number;
    missingInFigma: number;
    missingInHandoff: number;
    ambiguous: number;
    metadataGaps: number;
  };
  components: FigmaAuditComponentEntry[];
  figmaOnly: Array<{
    slug: string;
    figmaComponentName: string;
    figmaComponentSetId?: string;
    figmaFileKey?: string;
    figmaNodeId?: string;
    figmaInstanceCount?: number;
    figmaDescription?: string;
    figmaThumbnailUrl?: string;
    figmaPublishedComponentKeys?: string[];
    figmaVariantSchema?: FigmaVariantSchemaProperty[];
    figmaImages?: FigmaImageAsset[];
  }>;
};

type DocumentationComponentMap = CoreTypes.IDocumentationObject['components'];
type DocumentationInstance = CoreTypes.IComponentInstance;

type PublishedComponentMetadata = {
  key?: string;
  file_key?: string;
  node_id?: string;
  thumbnail_url?: string;
  name?: string;
  description?: string;
  updated_at?: string;
};

type PublishedFileComponent = PublishedComponentMetadata & {
  containing_frame?: {
    name?: string;
    nodeId?: string;
    pageId?: string;
    pageName?: string;
    containingStateGroup?: {
      name?: string;
      nodeId?: string;
    };
    containingComponentSet?: {
      name?: string;
      nodeId?: string;
    };
  };
};

type FigmaNodePaint = {
  type?: string;
  visible?: boolean;
  imageRef?: string;
};

type FigmaNodeDocument = {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  visible?: boolean;
  absoluteBoundingBox?: {
    width?: number;
    height?: number;
  };
  fills?: FigmaNodePaint[];
  children?: FigmaNodeDocument[];
};

type ProviderComponent = {
  name?: string;
  componentSetNode?: {
    id?: string;
    name?: string;
    componentPropertyDefinitions?: Record<string, { type?: string; defaultValue?: string; variantOptions?: string[] }>;
    children?: Array<{ id?: string }>;
  };
  componentsMetadata?: Map<string, PublishedComponentMetadata>;
  definition?: { name?: string };
};

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function normalizeName(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return slugify(trimmed);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function cleanToken(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildFigmaApiHeaders(accessToken: string | undefined | null): HeadersInit | null {
  const token = cleanToken(accessToken);
  if (!token) return null;
  if (/^Bearer\s+/i.test(token)) {
    return { Authorization: token };
  }
  return { 'X-Figma-Token': token };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function variantSchemaFromInstances(instances: DocumentationInstance[] = []): FigmaVariantSchemaProperty[] {
  const valuesByProp = new Map<string, Set<string>>();
  for (const instance of instances) {
    for (const [name, value] of instance.variantProperties ?? []) {
      if (!valuesByProp.has(name)) valuesByProp.set(name, new Set());
      valuesByProp.get(name)?.add(value);
    }
  }
  return [...valuesByProp.entries()]
    .map(([name, values]) => ({ name, values: [...values].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function variantSchemaFromComponentSet(componentSetNode: ProviderComponent['componentSetNode']): FigmaVariantSchemaProperty[] {
  const defs = componentSetNode?.componentPropertyDefinitions ?? {};
  return Object.entries(defs)
    .filter(([, definition]) => definition?.type === 'VARIANT')
    .map(([name, definition]) => ({
      name,
      values: [...new Set((definition?.variantOptions ?? []).filter(Boolean))].sort(),
      defaultValue: definition?.defaultValue,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mergeVariantSchemas(
  left: FigmaVariantSchemaProperty[] = [],
  right: FigmaVariantSchemaProperty[] = []
): FigmaVariantSchemaProperty[] {
  const merged = new Map<string, FigmaVariantSchemaProperty>();
  for (const entry of [...left, ...right]) {
    const existing = merged.get(entry.name);
    if (!existing) {
      merged.set(entry.name, { ...entry, values: [...entry.values].sort() });
      continue;
    }
    merged.set(entry.name, {
      name: entry.name,
      defaultValue: existing.defaultValue || entry.defaultValue,
      values: [...new Set([...existing.values, ...entry.values])].sort(),
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function previewsFromInstances(instances: DocumentationInstance[] = []): FigmaPreviewSeed[] {
  return instances.map((instance, index) => {
    const values = Object.fromEntries(instance.variantProperties ?? []);
    const fallbackId = uniqueStrings([instance.id, instance.name, `variant-${index + 1}`])[0] || `variant-${index + 1}`;
    return {
      id: fallbackId,
      title: fallbackId,
      values,
    };
  });
}

function variantValuesFromInstances(instances: DocumentationInstance[] = []): Record<string, string> | undefined {
  const first = instances.find((instance) => (instance.variantProperties?.length ?? 0) > 0);
  if (!first?.variantProperties?.length) return undefined;
  return Object.fromEntries(first.variantProperties);
}

function variantLabelFromValues(values?: Record<string, string>): string | undefined {
  if (!values) return undefined;
  const entries = Object.entries(values).filter(([, value]) => value?.trim());
  if (!entries.length) return undefined;
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}

function variantValuesFromLabel(label?: string): Record<string, string> | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  const entries = trimmed
    .split(/\s*,\s*/)
    .map((part) => {
      const pivot = part.indexOf('=');
      if (pivot <= 0) return null;
      const name = part.slice(0, pivot).trim();
      const value = part.slice(pivot + 1).trim();
      if (!name || !value) return null;
      return [name, value] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  if (!entries.length || entries.length !== trimmed.split(/\s*,\s*/).length) return undefined;
  return Object.fromEntries(entries);
}

function isVariantOnlyName(name?: string): boolean {
  return Boolean(variantValuesFromLabel(name));
}

function filterInstancesForChild(
  instances: DocumentationInstance[] = [],
  childId?: string,
  childName?: string
): DocumentationInstance[] {
  const normalizedName = normalizeName(childName);
  return instances.filter((instance) => {
    if (childId && instance.id === childId) return true;
    const instanceSlug = normalizeName(instance.name);
    return Boolean(normalizedName && instanceSlug && instanceSlug === normalizedName);
  });
}

function uniqueChildSlug(
  baseSlug: string | null,
  parentSlug: string,
  childId: string,
  used: Set<string>
): string {
  const fallback = `${parentSlug}-${childId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'variant'}`;
  const preferred = baseSlug || fallback;
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let index = 2;
  let next = `${preferred}-${index}`;
  while (used.has(next)) {
    index += 1;
    next = `${preferred}-${index}`;
  }
  used.add(next);
  return next;
}

function inferImageRole(name?: string): string | undefined {
  const value = name?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.includes('background')) return 'background';
  if (value.includes('illustration')) return 'illustration';
  if (value.includes('avatar')) return 'avatar';
  if (value.includes('icon')) return 'icon';
  if (value.includes('logo')) return 'logo';
  if (value.includes('photo')) return 'photo';
  if (value.includes('image') || value.includes('media')) return 'image';
  return undefined;
}

function findDimensions(value: unknown, depth: number = 0): { width?: number; height?: number } | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findDimensions(item, depth + 1);
      if (nested?.width !== undefined || nested?.height !== undefined) return nested;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;

  const width = toFiniteNumber(record.width ?? record.w ?? record.intrinsicWidth);
  const height = toFiniteNumber(record.height ?? record.h ?? record.intrinsicHeight);
  if (width !== undefined || height !== undefined) {
    return { width, height };
  }

  for (const key of ['dimensions', 'size', 'absoluteBoundingBox', 'absoluteRenderBounds', 'boundingBox', 'bounds', 'frame', 'rect']) {
    const nested = findDimensions(record[key], depth + 1);
    if (nested?.width !== undefined || nested?.height !== undefined) return nested;
  }

  return null;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function collectImageCandidateRecords(value: unknown, depth: number = 0): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectImageCandidateRecords(item, depth + 1));
  }

  const record = asRecord(value);
  if (!record) return [];

  const name = pickFirstString(record, ['name', 'part', 'key', 'type']);
  const hasImageFields = Boolean(
    pickFirstString(record, ['imageRef', 'imageHash', 'image', 'imageUrl', 'url', 'src'])
  );
  const looksLikeImage =
    Boolean(name && /(image|photo|background|avatar|illustration|logo|icon|media)/i.test(name)) ||
    pickFirstString(record, ['type', 'kind'])?.toUpperCase().includes('IMAGE') === true;

  const matchesHere = hasImageFields || looksLikeImage;
  const nested = Object.values(record).flatMap((child) => collectImageCandidateRecords(child, depth + 1));
  return matchesHere ? [record, ...nested] : nested;
}

function getInstanceParts(instance: DocumentationInstance): Record<string, unknown>[] {
  const raw = (instance as unknown as Record<string, unknown>).parts;
  if (Array.isArray(raw)) {
    return raw.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const record = asRecord(raw);
  if (!record) return [];
  return Object.entries(record)
    .map(([part, value]) => {
      const child = asRecord(value);
      return child ? { part, ...child } : null;
    })
    .filter((item): item is { part: string } & Record<string, unknown> => Boolean(item));
}

export function mergeFigmaImages(left: FigmaImageAsset[] = [], right: FigmaImageAsset[] = []): FigmaImageAsset[] {
  const merged = new Map<string, FigmaImageAsset>();
  for (const image of [...left, ...right]) {
    const key = [image.part, image.nodeId, image.imageRef, image.url, image.name].filter(Boolean).join('::');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...image });
      continue;
    }
    merged.set(key, {
      ...existing,
      ...image,
      width: image.width ?? existing.width,
      height: image.height ?? existing.height,
      role: existing.role ?? image.role,
      nodeId: existing.nodeId ?? image.nodeId,
      imageRef: existing.imageRef ?? image.imageRef,
      url: existing.url ?? image.url,
    });
  }
  return [...merged.values()];
}

function imagesFromInstances(instances: DocumentationInstance[] = []): FigmaImageAsset[] {
  const discovered: FigmaImageAsset[] = [];

  for (const instance of instances) {
    for (const part of getInstanceParts(instance)) {
      const partName =
        pickFirstString(part, ['part', 'name', 'key']) ||
        pickFirstString(asRecord((instance as unknown as Record<string, unknown>).name) ?? {}, ['name']) ||
        'image';
      const partDimensions = findDimensions(part) ?? {};
      const partNodeId = pickFirstString(part, ['nodeId', 'id']);
      const candidates = collectImageCandidateRecords(part);
      const seeds = candidates.length > 0 ? candidates : [part];

      for (const seed of seeds) {
        const name = pickFirstString(seed, ['name', 'part', 'key']) || partName;
        const dimensions = findDimensions(seed) ?? partDimensions;
        const imageRef = pickFirstString(seed, ['imageRef', 'imageHash', 'image']);
        const url = pickFirstString(seed, ['imageUrl', 'url', 'src']);
        const role = inferImageRole(name) || inferImageRole(partName);
        if (!imageRef && !url && dimensions.width === undefined && dimensions.height === undefined && !role) {
          continue;
        }

        discovered.push({
          name,
          role,
          imageRef,
          url,
          width: dimensions.width,
          height: dimensions.height,
          nodeId: pickFirstString(seed, ['nodeId', 'id']) || partNodeId,
          part: partName,
        });
      }
    }
  }

  return mergeFigmaImages(discovered);
}

function createEmptyCatalog(): FigmaComponentCatalog {
  return {
    entries: [],
    childEntries: [],
    byName: new Map(),
    byComponentKey: new Map(),
    byChildName: new Map(),
  };
}

function mergeCatalogEntry(
  existing: FigmaComponentCatalogEntry | undefined,
  incoming: Partial<FigmaComponentCatalogEntry> & Pick<FigmaComponentCatalogEntry, 'slug' | 'figmaComponentName'>
): FigmaComponentCatalogEntry {
  const merged: FigmaComponentCatalogEntry = {
    slug: incoming.slug,
    figmaComponentName: incoming.figmaComponentName || existing?.figmaComponentName || incoming.slug,
    previews: incoming.previews ?? existing?.previews ?? [],
    children: existing?.children ?? [],
    figmaPublishedComponentKeys: uniqueStrings([
      ...(existing?.figmaPublishedComponentKeys ?? []),
      ...(incoming.figmaPublishedComponentKeys ?? []),
    ]),
    figmaInstanceCount: incoming.figmaInstanceCount ?? existing?.figmaInstanceCount ?? 0,
    figmaVariantSchema: mergeVariantSchemas(existing?.figmaVariantSchema, incoming.figmaVariantSchema),
    figmaComponentKey: incoming.figmaComponentKey ?? existing?.figmaComponentKey,
    figmaFileKey: incoming.figmaFileKey ?? existing?.figmaFileKey,
    figmaNodeId: incoming.figmaNodeId ?? existing?.figmaNodeId,
    figmaComponentSetId: incoming.figmaComponentSetId ?? existing?.figmaComponentSetId,
    figmaComponentSetName:
      incoming.figmaComponentSetName ?? existing?.figmaComponentSetName ?? incoming.figmaComponentName ?? existing?.figmaComponentName,
    figmaDescription: incoming.figmaDescription ?? existing?.figmaDescription,
    figmaThumbnailUrl: incoming.figmaThumbnailUrl ?? existing?.figmaThumbnailUrl,
    figmaUpdatedAt: incoming.figmaUpdatedAt ?? existing?.figmaUpdatedAt,
    figmaImages: mergeFigmaImages(existing?.figmaImages, incoming.figmaImages),
  };
  merged.figma = incoming.figma ?? existing?.figma ?? buildFigmaUrl(merged.figmaFileKey, merged.figmaNodeId);
  return merged;
}

function mergeChildCatalogEntry(
  existing: FigmaChildComponentCatalogEntry | undefined,
  incoming: FigmaChildComponentCatalogEntry
): FigmaChildComponentCatalogEntry {
  if (!existing) {
    return {
      ...incoming,
      figmaPublishedComponentKeys: uniqueStrings(incoming.figmaPublishedComponentKeys ?? [incoming.figmaComponentKey]),
    };
  }

  return {
    ...existing,
    ...incoming,
    slug: incoming.slug || existing.slug,
    parentSlug: incoming.parentSlug || existing.parentSlug,
    figmaComponentName: incoming.figmaComponentName || existing.figmaComponentName,
    figmaComponentKey: incoming.figmaComponentKey || existing.figmaComponentKey,
    figmaNodeId: incoming.figmaNodeId || existing.figmaNodeId,
    previews: incoming.previews.length > 0 ? incoming.previews : existing.previews,
    figmaPublishedComponentKeys: uniqueStrings([
      ...(existing.figmaPublishedComponentKeys ?? []),
      ...(incoming.figmaPublishedComponentKeys ?? []),
      incoming.figmaComponentKey,
    ]),
    figmaVariantSchema: mergeVariantSchemas(existing.figmaVariantSchema, incoming.figmaVariantSchema),
    figmaImages: mergeFigmaImages(existing.figmaImages, incoming.figmaImages),
    figmaVariantValues: existing.figmaVariantValues ?? incoming.figmaVariantValues,
    figmaVariantLabel: existing.figmaVariantLabel ?? incoming.figmaVariantLabel,
    figmaDescription: existing.figmaDescription ?? incoming.figmaDescription,
    figmaThumbnailUrl: existing.figmaThumbnailUrl ?? incoming.figmaThumbnailUrl,
    figmaUpdatedAt: existing.figmaUpdatedAt ?? incoming.figmaUpdatedAt,
    figmaFileKey: existing.figmaFileKey ?? incoming.figmaFileKey,
    figmaComponentSetId: existing.figmaComponentSetId ?? incoming.figmaComponentSetId,
    figmaComponentSetName: existing.figmaComponentSetName ?? incoming.figmaComponentSetName,
    figma: existing.figma ?? incoming.figma,
  };
}

async function loadProviderComponents(handoff: Handoff): Promise<ProviderComponent[]> {
  const projectId = handoff.config?.figma_project_id;
  const accessToken = handoff.config?.dev_access_token;
  if (!projectId || !accessToken) return [];
  const provider = Providers.RestApiProvider({ projectId, accessToken });
  if (!provider.getComponents) return [];
  try {
    return ((await provider.getComponents()) as ProviderComponent[]) ?? [];
  } catch {
    return [];
  }
}

async function loadPublishedFileComponents(handoff: Handoff): Promise<PublishedFileComponent[]> {
  const projectId = handoff.config?.figma_project_id;
  const headers = buildFigmaApiHeaders(handoff.config?.dev_access_token);
  if (!projectId || !headers) return [];

  try {
    const response = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(projectId)}/components`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      meta?: {
        components?: PublishedFileComponent[];
      };
    };
    return json.meta?.components ?? [];
  } catch {
    return [];
  }
}

function imageAssetsFromNodeTree(node: FigmaNodeDocument | undefined, pathSegments: string[] = []): FigmaImageAsset[] {
  if (!node || node.visible === false) return [];

  const nodeName = cleanToken(node.name) ?? 'image';
  const nextPath = [...pathSegments, nodeName];
  const dimensions = findDimensions(node) ?? {};
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const ownImages = fills
    .filter((fill) => fill?.type === 'IMAGE' && fill.visible !== false)
    .map((fill): FigmaImageAsset => ({
      name: nodeName,
      role: inferImageRole(nodeName),
      imageRef: cleanToken(fill.imageRef) ?? undefined,
      width: dimensions.width,
      height: dimensions.height,
      nodeId: cleanToken(node.id) ?? undefined,
      part: nextPath.join('/'),
    }));

  const childImages = (node.children ?? []).flatMap((child) => imageAssetsFromNodeTree(child, nextPath));
  return mergeFigmaImages(ownImages, childImages);
}

function propertySeedsFromNodeTree(
  node: FigmaNodeDocument | undefined,
  pathSegments: string[] = [],
  usedKeys: Set<string> = new Set()
): FigmaNodePropertySeed[] {
  if (!node || node.visible === false) return [];

  const nodeName = cleanToken(node.name) ?? 'field';
  const nextPath = [...pathSegments, nodeName];
  const nodePath = nextPath.join('/');
  const dimensions = findDimensions(node) ?? {};
  const seeds: FigmaNodePropertySeed[] = [];

  const pushSeed = (seed: Omit<FigmaNodePropertySeed, 'key'>) => {
    const baseKey = normalizeName(seed.name) || normalizeName(seed.nodePath) || 'field';
    let key = baseKey;
    let index = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}-${index++}`;
    }
    usedKeys.add(key);
    seeds.push({ key, ...seed });
  };

  if (node.type === 'TEXT') {
    const characters = cleanToken(node.characters);
    pushSeed({
      name: nodeName,
      suggestedType: 'text',
      nodePath,
      defaultValue: characters ?? nodeName,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const fills = Array.isArray(node.fills) ? node.fills : [];
  const hasImageFill = fills.some((fill) => fill?.type === 'IMAGE' && fill.visible !== false);
  if (hasImageFill) {
    pushSeed({
      name: nodeName,
      suggestedType: 'image',
      nodePath,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const childSeeds = (node.children ?? []).flatMap((child) => propertySeedsFromNodeTree(child, nextPath, usedKeys));
  return [...seeds, ...childSeeds];
}

async function fetchFigmaNodeDocument(fileKey: string, nodeId: string, accessToken: string): Promise<FigmaNodeDocument | undefined> {
  const headers = buildFigmaApiHeaders(accessToken);
  const cleanFileKey = cleanToken(fileKey);
  const cleanNodeId = cleanToken(nodeId);
  if (!headers || !cleanFileKey || !cleanNodeId) return undefined;

  try {
    const response = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(cleanFileKey)}/nodes?ids=${encodeURIComponent(cleanNodeId)}`,
      {
        headers,
        cache: 'no-store',
      }
    );
    if (!response.ok) return undefined;
    const json = (await response.json()) as {
      nodes?: Record<string, { document?: FigmaNodeDocument }>;
    };
    return json.nodes?.[cleanNodeId]?.document;
  } catch {
    return undefined;
  }
}

export async function fetchNodeImages(fileKey: string, nodeId: string, accessToken: string): Promise<FigmaImageAsset[]> {
  return imageAssetsFromNodeTree(await fetchFigmaNodeDocument(fileKey, nodeId, accessToken));
}

/**
 * Raster export URLs for node ids (short-lived). Uses the same auth style as other Figma REST calls.
 * @see https://www.figma.com/developers/api#get-images-endpoint
 */
export async function fetchFigmaRasterExportUrls(
  fileKey: string,
  nodeIds: string[],
  accessToken: string,
  options?: { format?: 'png' | 'jpg' | 'svg' | 'pdf'; scale?: number }
): Promise<Record<string, string | null>> {
  const headers = buildFigmaApiHeaders(accessToken);
  const fk = cleanToken(fileKey);
  if (!headers || !fk) return {};

  const unique = [...new Set(nodeIds.map((id) => cleanToken(id)).filter(Boolean))] as string[];
  const result: Record<string, string | null> = {};
  const chunkSize = 35;
  const format = options?.format ?? 'png';

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const params = new URLSearchParams({ ids: chunk.join(','), format });
    const scale = options?.scale;
    if (scale !== undefined && Number.isFinite(scale)) params.set('scale', String(scale));
    try {
      const response = await fetch(`https://api.figma.com/v1/images/${encodeURIComponent(fk)}?${params}`, {
        headers,
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const json = (await response.json()) as { err?: string; images?: Record<string, string | null> };
      if (json.err) continue;
      Object.assign(result, json.images ?? {});
    } catch {
      /* skip chunk */
    }
  }

  return result;
}

export async function fetchNodePropertySeeds(fileKey: string, nodeId: string, accessToken: string): Promise<FigmaNodePropertySeed[]> {
  return propertySeedsFromNodeTree(await fetchFigmaNodeDocument(fileKey, nodeId, accessToken));
}

export async function loadFigmaComponentCatalog(handoff: Handoff): Promise<FigmaComponentCatalog> {
  const documentationObject = await handoff.getDocumentationObject();
  const entries = new Map<string, FigmaComponentCatalogEntry>();
  const childEntriesByKey = new Map<string, FigmaChildComponentCatalogEntry>();
  const childEntriesByNodeId = new Map<string, FigmaChildComponentCatalogEntry>();
  const usedChildSlugs = new Set<string>();
  const documentationInstancesBySlug = new Map<string, DocumentationInstance[]>();

  const registerChildEntry = (incoming: FigmaChildComponentCatalogEntry): FigmaChildComponentCatalogEntry => {
    const existing =
      childEntriesByKey.get(incoming.figmaComponentKey) ||
      childEntriesByNodeId.get(incoming.figmaNodeId);
    const merged = mergeChildCatalogEntry(existing, incoming);
    childEntriesByKey.set(merged.figmaComponentKey, merged);
    childEntriesByNodeId.set(merged.figmaNodeId, merged);
    return merged;
  };

  const documentationComponents = documentationObject?.components ?? ({} as DocumentationComponentMap);
  for (const [name, data] of Object.entries(documentationComponents)) {
    const slug = normalizeName(name);
    if (!slug) continue;
    documentationInstancesBySlug.set(slug, data.instances ?? []);
    entries.set(
      slug,
      mergeCatalogEntry(entries.get(slug), {
        slug,
        figmaComponentName: name,
        figmaComponentSetName: name,
        figmaInstanceCount: data.instances?.length ?? 0,
        figmaVariantSchema: variantSchemaFromInstances(data.instances ?? []),
        figmaImages: imagesFromInstances(data.instances ?? []),
        previews: previewsFromInstances(data.instances ?? []),
      })
    );
  }

  const publishedComponents = await loadPublishedFileComponents(handoff);
  for (const publishedComponent of publishedComponents) {
    const rawChildName = publishedComponent.name?.trim();
    const containingFrame = publishedComponent.containing_frame;
    const parentSetId =
      containingFrame?.containingComponentSet?.nodeId ||
      containingFrame?.containingStateGroup?.nodeId;
    const parentSetName =
      containingFrame?.containingComponentSet?.name ||
      containingFrame?.containingStateGroup?.name;
    const parentName = parentSetName || rawChildName || containingFrame?.name || 'Figma Component';
    const parentSlug =
      normalizeName(parentName) ||
      normalizeName(rawChildName) ||
      slugify(publishedComponent.key || publishedComponent.node_id || 'figma-component');
    const documentationInstances = documentationInstancesBySlug.get(parentSlug) ?? [];
    const instances = filterInstancesForChild(documentationInstances, publishedComponent.node_id, rawChildName);
    const variantValues = variantValuesFromInstances(instances) ?? variantValuesFromLabel(rawChildName);
    const inferredVariantLabel = variantLabelFromValues(variantValues) ?? (isVariantOnlyName(rawChildName) ? rawChildName : undefined);
    const childName = parentSetName && isVariantOnlyName(rawChildName) ? parentName : rawChildName || parentName;
    const childSlugSource =
      parentSetName && isVariantOnlyName(rawChildName)
        ? `${parentName}-${inferredVariantLabel ?? publishedComponent.key ?? publishedComponent.node_id}`
        : childName;
    const existingPublishedChild =
      (publishedComponent.key ? childEntriesByKey.get(publishedComponent.key) : undefined) ||
      (publishedComponent.node_id ? childEntriesByNodeId.get(publishedComponent.node_id) : undefined);
    const childSlug =
      existingPublishedChild?.slug ||
      uniqueChildSlug(normalizeName(childSlugSource), parentSlug, publishedComponent.node_id || publishedComponent.key || parentName, usedChildSlugs);

    entries.set(
      parentSlug,
      mergeCatalogEntry(entries.get(parentSlug), {
        slug: parentSlug,
        figmaComponentName: parentName,
        figmaComponentKey: parentSetId ? undefined : publishedComponent.key,
        figmaPublishedComponentKeys: uniqueStrings([publishedComponent.key]),
        figmaFileKey: publishedComponent.file_key,
        figmaNodeId: parentSetId || publishedComponent.node_id,
        figmaComponentSetId: parentSetId,
        figmaComponentSetName: parentSetName || parentName,
        figmaDescription: publishedComponent.description,
        figmaThumbnailUrl: publishedComponent.thumbnail_url,
        figmaUpdatedAt: publishedComponent.updated_at,
        figmaInstanceCount: instances.length || 1,
        figma: buildFigmaUrl(publishedComponent.file_key, parentSetId || publishedComponent.node_id),
      })
    );

    registerChildEntry({
      slug: childSlug,
      parentSlug,
      figmaComponentName: childName,
      figmaComponentKey: publishedComponent.key || publishedComponent.node_id || childSlug,
      figmaPublishedComponentKeys: uniqueStrings([publishedComponent.key]),
      figmaFileKey: publishedComponent.file_key,
      figmaNodeId: publishedComponent.node_id || childSlug,
      figmaComponentSetId: parentSetId,
      figmaComponentSetName: parentSetName || undefined,
      figmaDescription: publishedComponent.description,
      figmaThumbnailUrl: publishedComponent.thumbnail_url,
      figmaUpdatedAt: publishedComponent.updated_at,
      figmaVariantValues: variantValues,
      figmaVariantLabel: inferredVariantLabel,
      figmaInstanceCount: instances.length,
      figmaImages: imagesFromInstances(instances),
      previews: previewsFromInstances(instances),
      figma: buildFigmaUrl(publishedComponent.file_key, publishedComponent.node_id),
    });
  }

  const providerComponents = await loadProviderComponents(handoff);
  for (const providerComponent of providerComponents) {
    const componentSetNode = providerComponent.componentSetNode;
    const slug =
      normalizeName(providerComponent.name) ||
      normalizeName(providerComponent.definition?.name) ||
      normalizeName(componentSetNode?.name);
    if (!slug) continue;

    const childIds = componentSetNode?.children?.map((child) => child?.id).filter(Boolean) as string[] | undefined;
    const variantMetadata = (childIds ?? [])
      .map((childId) => providerComponent.componentsMetadata?.get(childId))
      .filter((item): item is PublishedComponentMetadata => Boolean(item));

    const updatedAt = [...new Set(variantMetadata.map((item) => item.updated_at).filter(Boolean))].sort().at(-1);
    const figmaComponentKeys = uniqueStrings(variantMetadata.map((item) => item.key));
    const parentName = componentSetNode?.name || providerComponent.definition?.name || providerComponent.name || slug;
    const documentationInstances = documentationInstancesBySlug.get(slug) ?? [];

    entries.set(
      slug,
      mergeCatalogEntry(entries.get(slug), {
        slug,
        figmaComponentName: parentName,
        figmaComponentKey: figmaComponentKeys.length === 1 ? figmaComponentKeys[0] : undefined,
        figmaPublishedComponentKeys: figmaComponentKeys,
        figmaFileKey: variantMetadata.find((item) => item.file_key)?.file_key,
        figmaNodeId: componentSetNode?.id,
        figmaComponentSetId: componentSetNode?.id,
        figmaComponentSetName: parentName,
        figmaDescription: variantMetadata.find((item) => item.description)?.description,
        figmaThumbnailUrl: variantMetadata.find((item) => item.thumbnail_url)?.thumbnail_url,
        figmaUpdatedAt: updatedAt,
        figmaVariantSchema: variantSchemaFromComponentSet(componentSetNode),
        figma: buildFigmaUrl(variantMetadata.find((item) => item.file_key)?.file_key, componentSetNode?.id),
      })
    );

    for (const childId of childIds ?? []) {
      const metadata = providerComponent.componentsMetadata?.get(childId);
      const rawChildName = metadata?.name?.trim();
      const instances = filterInstancesForChild(documentationInstances, metadata?.node_id || childId, rawChildName);
      const variantValues = variantValuesFromInstances(instances) ?? variantValuesFromLabel(rawChildName);
      const inferredVariantLabel = variantLabelFromValues(variantValues) ?? (isVariantOnlyName(rawChildName) ? rawChildName : undefined);
      const childName = isVariantOnlyName(rawChildName) ? parentName : rawChildName || `${parentName} Variant`;
      const childSlugSource = isVariantOnlyName(rawChildName) ? `${parentName}-${inferredVariantLabel ?? childId}` : childName;
      const existingChild =
        (metadata?.key ? childEntriesByKey.get(metadata.key) : undefined) ||
        (metadata?.node_id ? childEntriesByNodeId.get(metadata.node_id) : undefined) ||
        childEntriesByNodeId.get(childId);
      const childSlug = existingChild?.slug || uniqueChildSlug(normalizeName(childSlugSource), slug, childId, usedChildSlugs);

      registerChildEntry({
        slug: childSlug,
        parentSlug: slug,
        figmaComponentName: childName,
        figmaComponentKey: metadata?.key || childId,
        figmaPublishedComponentKeys: uniqueStrings([metadata?.key]),
        figmaFileKey: metadata?.file_key || variantMetadata.find((item) => item.file_key)?.file_key,
        figmaNodeId: metadata?.node_id || childId,
        figmaComponentSetId: componentSetNode?.id,
        figmaComponentSetName: parentName,
        figmaDescription: metadata?.description,
        figmaThumbnailUrl: metadata?.thumbnail_url,
        figmaUpdatedAt: metadata?.updated_at,
        figmaVariantSchema: variantSchemaFromComponentSet(componentSetNode),
        figmaVariantValues: variantValues,
        figmaVariantLabel: inferredVariantLabel,
        figmaInstanceCount: instances.length,
        figmaImages: imagesFromInstances(instances),
        previews: previewsFromInstances(instances),
        figma: buildFigmaUrl(metadata?.file_key || variantMetadata.find((item) => item.file_key)?.file_key, metadata?.node_id || childId),
      });
    }
  }

  const catalog = createEmptyCatalog();
  const childEntries = [...childEntriesByKey.values()];
  const childrenByParent = new Map<string, FigmaChildComponentCatalogEntry[]>();
  for (const childEntry of childEntries) {
    const current = childrenByParent.get(childEntry.parentSlug) ?? [];
    current.push(childEntry);
    childrenByParent.set(childEntry.parentSlug, current);
  }

  catalog.entries = [...entries.values()]
    .map((entry) => ({
      ...entry,
      children: (childrenByParent.get(entry.slug) ?? []).sort((a, b) => a.figmaComponentName.localeCompare(b.figmaComponentName)),
    }))
    .sort((a, b) => a.figmaComponentName.localeCompare(b.figmaComponentName));
  catalog.childEntries = childEntries.sort((a, b) => a.figmaComponentName.localeCompare(b.figmaComponentName));
  for (const entry of catalog.entries) {
    catalog.byName.set(entry.slug, entry);
  }
  for (const entry of catalog.childEntries) {
    catalog.byComponentKey.set(entry.figmaComponentKey, entry);
    const childNameMatches = catalog.byChildName.get(entry.slug) ?? [];
    childNameMatches.push(entry);
    catalog.byChildName.set(entry.slug, childNameMatches);
  }
  for (const entry of catalog.entries) {
    for (const child of entry.children) {
      if (!child.figmaImages?.length) {
        child.figmaImages = entry.figmaImages;
      }
      if (!child.figmaThumbnailUrl) {
        child.figmaThumbnailUrl = entry.figmaThumbnailUrl;
      }
      if (!child.figmaDescription) {
        child.figmaDescription = entry.figmaDescription;
      }
      if (!child.previews.length) {
        child.previews = entry.previews;
      }
      if (!child.figmaVariantSchema?.length) {
        child.figmaVariantSchema = entry.figmaVariantSchema;
      }
    }
  }
  return catalog;
}

function sameResolvedTarget(left: HandoffFigmaMatch, right: HandoffFigmaMatch): boolean {
  if (left.child?.figmaComponentKey && right.child?.figmaComponentKey) {
    return left.child.figmaComponentKey === right.child.figmaComponentKey;
  }
  if (left.child?.figmaComponentKey && right.entry?.slug) {
    return left.entry?.slug === right.entry.slug;
  }
  if (left.entry?.slug && right.child?.figmaComponentKey) {
    return left.entry.slug === right.entry?.slug;
  }
  if (left.entry?.slug && right.entry?.slug) {
    return left.entry.slug === right.entry.slug;
  }
  return false;
}

function resolveParentEntryForChild(
  child: FigmaChildComponentCatalogEntry,
  catalog: FigmaComponentCatalog
): FigmaComponentCatalogEntry | undefined {
  return catalog.byName.get(child.parentSlug);
}

function finalizeSetMatch(
  entry: FigmaComponentCatalogEntry,
  matchedBy: Exclude<FigmaMatchedBy, null>,
  status: Extract<FigmaMatchStatus, 'matched' | 'unlinked'>
): HandoffFigmaMatch {
  if (entry.children.length === 1) {
    return {
      status,
      matchedBy,
      entry,
      child: entry.children[0],
    };
  }
  if (entry.children.length > 1) {
    return {
      status: 'ambiguous',
      matchedBy,
      entry,
    };
  }
  return {
    status,
    matchedBy,
    entry,
  };
}

function resolveBySlug(
  slug: string,
  catalog: FigmaComponentCatalog,
  matchedBy: Exclude<FigmaMatchedBy, null>,
  status: Extract<FigmaMatchStatus, 'matched' | 'unlinked'>
): HandoffFigmaMatch | undefined {
  const setEntry = catalog.byName.get(slug);
  if (setEntry) {
    return finalizeSetMatch(setEntry, matchedBy, status);
  }

  const childEntries = catalog.byChildName.get(slug) ?? [];
  if (childEntries.length === 1) {
    const child = childEntries[0];
    return {
      status,
      matchedBy,
      entry: resolveParentEntryForChild(child, catalog),
      child,
    };
  }
  if (childEntries.length > 1) {
    return {
      status: 'ambiguous',
      matchedBy,
    };
  }
  return undefined;
}

export function matchHandoffComponentToFigma(
  component: { id: string; figmaComponentId?: string; figmaComponentKey?: string },
  catalog: FigmaComponentCatalog
): HandoffFigmaMatch {
  if (component.figmaComponentKey) {
    const child = catalog.byComponentKey.get(component.figmaComponentKey);
    const explicitKeyMatch = child
      ? {
          status: 'matched' as const,
          matchedBy: 'component_key' as const,
          entry: resolveParentEntryForChild(child, catalog),
          child,
        }
      : undefined;

    const figmaComponentIdSlug = normalizeName(component.figmaComponentId);
    if (explicitKeyMatch && figmaComponentIdSlug) {
      const fallbackMatch = resolveBySlug(figmaComponentIdSlug, catalog, 'figma_component_id', 'matched');
      if (fallbackMatch && !sameResolvedTarget(explicitKeyMatch, fallbackMatch)) {
        return { status: 'ambiguous', matchedBy: null };
      }
    }

    if (explicitKeyMatch) {
      return explicitKeyMatch;
    }
  }

  const figmaComponentIdSlug = normalizeName(component.figmaComponentId);
  if (figmaComponentIdSlug) {
    const explicitIdMatch = resolveBySlug(figmaComponentIdSlug, catalog, 'figma_component_id', 'matched');
    if (explicitIdMatch) {
      return explicitIdMatch;
    }
  }

  const runtimeIdSlug = normalizeName(component.id);
  if (runtimeIdSlug && catalog.byName.has(runtimeIdSlug) && !component.figmaComponentId && !component.figmaComponentKey) {
    return finalizeSetMatch(catalog.byName.get(runtimeIdSlug) as FigmaComponentCatalogEntry, 'runtime_id', 'unlinked');
  }

  if (runtimeIdSlug && !component.figmaComponentId && !component.figmaComponentKey) {
    const runtimeChildMatch = resolveBySlug(runtimeIdSlug, catalog, 'runtime_id', 'unlinked');
    if (runtimeChildMatch) {
      return runtimeChildMatch;
    }
  }

  return { status: 'missing_in_figma', matchedBy: null };
}

export function getMissingFigmaMetadata(
  component: Partial<FigmaComponentLinkData>,
  match: HandoffFigmaMatch
): string[] {
  const entry = match.child ?? match.entry;
  if (!entry && !match.entry) return [];
  const expected = {
    figma: match.child?.figma || match.entry?.figma,
    figmaComponentKey: match.child?.figmaComponentKey,
    figmaPublishedComponentKeys: match.entry?.figmaPublishedComponentKeys ?? match.child?.figmaPublishedComponentKeys,
    figmaFileKey: match.child?.figmaFileKey || match.entry?.figmaFileKey,
    figmaNodeId: match.child?.figmaNodeId || match.entry?.figmaNodeId,
    figmaComponentSetId: match.entry?.figmaComponentSetId || match.child?.figmaComponentSetId,
    figmaComponentSetName: match.entry?.figmaComponentSetName || match.entry?.figmaComponentName || match.child?.figmaComponentSetName,
    figmaComponentName: match.child?.figmaComponentName || match.entry?.figmaComponentName,
    figmaDescription: match.child?.figmaDescription || match.entry?.figmaDescription,
    figmaThumbnailUrl: match.child?.figmaThumbnailUrl || match.entry?.figmaThumbnailUrl,
    figmaUpdatedAt: match.child?.figmaUpdatedAt || match.entry?.figmaUpdatedAt,
    figmaVariantSchema: match.entry?.figmaVariantSchema || match.child?.figmaVariantSchema,
    figmaVariantLabel: match.child?.figmaVariantLabel,
    figmaVariantValues: match.child?.figmaVariantValues,
    figmaInstanceCount: match.child?.figmaInstanceCount ?? match.entry?.figmaInstanceCount,
    figmaImages: match.child?.figmaImages?.length ? match.child.figmaImages : match.entry?.figmaImages,
  } satisfies Partial<FigmaComponentLinkData>;

  const checks: Array<[string, unknown, unknown]> = [
    ['figma', component.figma, expected.figma],
    ['figmaComponentKey', component.figmaComponentKey, expected.figmaComponentKey],
    ['figmaComponentName', component.figmaComponentName, expected.figmaComponentName],
    ['figmaFileKey', component.figmaFileKey, expected.figmaFileKey],
    ['figmaNodeId', component.figmaNodeId, expected.figmaNodeId],
    ['figmaComponentSetId', component.figmaComponentSetId, expected.figmaComponentSetId],
    ['figmaComponentSetName', component.figmaComponentSetName, expected.figmaComponentSetName],
    ['figmaPublishedComponentKeys', component.figmaPublishedComponentKeys, expected.figmaPublishedComponentKeys],
    ['figmaThumbnailUrl', component.figmaThumbnailUrl, expected.figmaThumbnailUrl],
    ['figmaUpdatedAt', component.figmaUpdatedAt, expected.figmaUpdatedAt],
    ['figmaDescription', component.figmaDescription, expected.figmaDescription],
    ['figmaVariantSchema', component.figmaVariantSchema, expected.figmaVariantSchema],
    ['figmaVariantLabel', component.figmaVariantLabel, expected.figmaVariantLabel],
    ['figmaVariantValues', component.figmaVariantValues, expected.figmaVariantValues],
    ['figmaInstanceCount', component.figmaInstanceCount, expected.figmaInstanceCount],
    ['figmaImages', component.figmaImages, expected.figmaImages],
  ];
  return checks
    .filter(([, actual, expected]) => hasValue(expected) && !hasValue(actual))
    .map(([field]) => field);
}

export function enrichComponentWithFigmaData<T extends FigmaComponentLinkData & { id: string }>(
  component: T,
  match: HandoffFigmaMatch
): T {
  const missingMetadata = getMissingFigmaMetadata(component, match);
  const enriched = {
    ...component,
    figmaMatchStatus: match.status,
    figmaMatchedBy: match.matchedBy ?? undefined,
    figmaMissingMetadata: missingMetadata,
  } as T;

  if (!match.entry) {
    return enriched;
  }

  return {
    ...enriched,
    figma: component.figma || match.child?.figma || match.entry.figma,
    figmaComponentId: component.figmaComponentId || match.child?.slug || match.entry.slug,
    figmaComponentKey: component.figmaComponentKey || match.child?.figmaComponentKey || match.entry.figmaComponentKey,
    figmaPublishedComponentKeys:
      component.figmaPublishedComponentKeys?.length ? component.figmaPublishedComponentKeys : match.entry.figmaPublishedComponentKeys,
    figmaFileKey: component.figmaFileKey || match.child?.figmaFileKey || match.entry.figmaFileKey,
    figmaNodeId: component.figmaNodeId || match.child?.figmaNodeId || match.entry.figmaNodeId,
    figmaComponentSetId: component.figmaComponentSetId || match.entry.figmaComponentSetId || match.child?.figmaComponentSetId,
    figmaComponentSetName:
      component.figmaComponentSetName ||
      match.entry.figmaComponentSetName ||
      match.entry.figmaComponentName ||
      match.child?.figmaComponentSetName,
    figmaComponentName: component.figmaComponentName || match.child?.figmaComponentName || match.entry.figmaComponentName,
    figmaDescription: component.figmaDescription || match.child?.figmaDescription || match.entry.figmaDescription,
    figmaThumbnailUrl: component.figmaThumbnailUrl || match.child?.figmaThumbnailUrl || match.entry.figmaThumbnailUrl,
    figmaUpdatedAt: component.figmaUpdatedAt || match.child?.figmaUpdatedAt || match.entry.figmaUpdatedAt,
    figmaVariantSchema:
      component.figmaVariantSchema && component.figmaVariantSchema.length > 0 ? component.figmaVariantSchema : match.entry.figmaVariantSchema,
    figmaVariantLabel: component.figmaVariantLabel || match.child?.figmaVariantLabel,
    figmaVariantValues: component.figmaVariantValues || match.child?.figmaVariantValues,
    figmaInstanceCount: component.figmaInstanceCount ?? match.child?.figmaInstanceCount ?? match.entry.figmaInstanceCount,
    figmaImages:
      component.figmaImages && component.figmaImages.length > 0
        ? component.figmaImages
        : match.child?.figmaImages?.length
          ? match.child.figmaImages
          : match.entry.figmaImages,
  };
}

export function mergeFigmaPreviewsIntoComponent<T extends { previews?: Record<string, any> }>(
  component: T,
  match: HandoffFigmaMatch
): T {
  if (!match.entry && !match.child) return component;
  const sourcePreviews = match.child?.previews?.length ? match.child.previews : match.entry?.previews ?? [];
  const previews = { ...(component.previews ?? {}) };
  for (const preview of sourcePreviews) {
    previews[preview.id] = {
      title: preview.title,
      url: previews[preview.id]?.url ?? '',
      usage: previews[preview.id]?.usage ?? '',
      values: preview.values,
    };
  }
  return { ...component, previews };
}

export function createFigmaAuditReport(
  components: Array<{ id: string; title?: string } & FigmaComponentLinkData>,
  catalog: FigmaComponentCatalog
): FigmaAuditReport {
  const matchedSlugs = new Set<string>();
  const componentEntries: FigmaAuditComponentEntry[] = components.map((component) => {
    const match = matchHandoffComponentToFigma(component, catalog);
    if (match.entry?.slug) matchedSlugs.add(match.entry.slug);
    return {
      id: component.id,
      title: component.title || component.id,
      status: match.status,
      matchedBy: match.matchedBy,
      figmaComponentId: component.figmaComponentId,
      figmaComponentKey: component.figmaComponentKey,
      matchedFigmaComponentName: match.child?.figmaComponentName || match.entry?.figmaComponentName,
      missingMetadata: getMissingFigmaMetadata(component, match),
    };
  });

  const figmaOnly = catalog.entries
    .filter((entry) => !matchedSlugs.has(entry.slug))
    .map((entry) => ({
      slug: entry.slug,
      figmaComponentName: entry.figmaComponentName,
      figmaComponentSetId: entry.figmaComponentSetId,
      figmaFileKey: entry.figmaFileKey,
      figmaNodeId: entry.figmaNodeId,
      figmaInstanceCount: entry.figmaInstanceCount,
      figmaDescription: entry.figmaDescription,
      figmaThumbnailUrl: entry.figmaThumbnailUrl,
      figmaPublishedComponentKeys: entry.figmaPublishedComponentKeys,
      figmaVariantSchema: entry.figmaVariantSchema,
      figmaImages: entry.figmaImages,
    }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      figmaComponents: catalog.entries.length,
      handoffComponents: components.length,
      matched: componentEntries.filter((entry) => entry.status === 'matched').length,
      unlinked: componentEntries.filter((entry) => entry.status === 'unlinked').length,
      missingInFigma: componentEntries.filter((entry) => entry.status === 'missing_in_figma').length,
      missingInHandoff: figmaOnly.length,
      ambiguous: componentEntries.filter((entry) => entry.status === 'ambiguous').length,
      metadataGaps: componentEntries.filter((entry) => entry.missingMetadata.length > 0).length,
    },
    components: componentEntries.sort((a, b) => a.id.localeCompare(b.id)),
    figmaOnly,
  };
}
