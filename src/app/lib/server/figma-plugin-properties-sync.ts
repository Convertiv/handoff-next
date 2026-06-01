import 'server-only';

import { fetchFigmaRasterExportUrls, mergeFigmaImages, type FigmaImageAsset } from '@handoff/figma/component-linking';
import { slugify } from '@handoff/transformers/utils/string';
import type { ComponentListObject, ComponentObject, OptionalPreviewRender, TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { SlotType, type SlotMetadata } from '@handoff/transformers/preview/slots';
import type { IDetectedImage, IDetectedProperty, PushComponentPropertiesRequest, PushComponentPropertiesResponse } from '@/lib/figma-plugin-contract';
import { getDbComponents } from '@/lib/db/queries';
import { getPublicApiDir } from '@/lib/server/public-api-paths';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_SLOT_TYPE = 'image';

type PluginComponentMatch = {
  componentId: string;
  matchedBy: PushComponentPropertiesResponse['matchedBy'];
};

type ImageDimensionRules = {
  width: number;
  height: number;
  min: { width: number; height: number };
  max: { width: number; height: number };
  recommend: { width: number; height: number };
};

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function componentApiPath(componentId: string): string {
  return path.join(getPublicApiDir(), 'component', `${componentId}.json`);
}

function componentSummaryPath(): string {
  return path.join(getPublicApiDir(), 'components.json');
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readPublicComponentApi(componentId: string): Promise<TransformComponentTokensResult | null> {
  return readJsonIfExists<TransformComponentTokensResult>(componentApiPath(componentId));
}

async function writePublicComponentApi(componentId: string, data: TransformComponentTokensResult): Promise<void> {
  const filePath = componentApiPath(componentId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

function componentListFromDbRow(row: Awaited<ReturnType<typeof getDbComponents>>[number]): ComponentListObject {
  if (row.data && typeof row.data === 'object') {
    return row.data as ComponentListObject;
  }
  return {
    id: row.id,
    path: row.path ?? `/${row.id}`,
    title: row.title,
    description: row.description ?? '',
    group: row.group ?? '',
    image: row.image ?? '',
    type: row.type ?? 'element',
    properties: (row.properties ?? {}) as ComponentListObject['properties'],
    previews: (row.previews ?? {}) as ComponentListObject['previews'],
  } as ComponentListObject;
}

async function listComponentsForPluginMatch(): Promise<ComponentListObject[]> {
  if (process.env.DATABASE_URL?.trim()) {
    const rows = await getDbComponents();
    return rows.map(componentListFromDbRow);
  }
  return (await readJsonIfExists<ComponentListObject[]>(componentSummaryPath())) ?? [];
}

async function getRuntimeComponent(componentId: string): Promise<ComponentObject | TransformComponentTokensResult | null> {
  if (process.env.DATABASE_URL?.trim()) {
    const rows = await getDbComponents();
    const row = rows.find((entry) => entry.id === componentId);
    if (row?.data && typeof row.data === 'object') {
      return row.data as ComponentObject;
    }
  }
  return readPublicComponentApi(componentId);
}

function inferImageDimensions(image: FigmaImageAsset): ImageDimensionRules | undefined {
  if (image.width === undefined || image.height === undefined) return undefined;
  return {
    width: image.width,
    height: image.height,
    min: { width: image.width, height: image.height },
    max: { width: image.width, height: image.height },
    recommend: { width: image.width, height: image.height },
  };
}

function toSlotKey(value: string, fallback: string): string {
  const normalized = slugify(value || fallback).replace(/-+/g, '-');
  const camel = normalized.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
  return camel || fallback;
}

function slotTypeFromDetectedProperty(detected: IDetectedProperty): SlotMetadata['type'] {
  switch (detected.suggestedType) {
    case 'image':
      return SlotType.IMAGE;
    case 'button':
    case 'link':
      return SlotType.BUTTON;
    case 'boolean':
      return SlotType.BOOLEAN;
    case 'array':
      return SlotType.ARRAY;
    case 'object':
      return SlotType.OBJECT;
    default:
      return SlotType.TEXT;
  }
}

function toFigmaImageAssets(images: IDetectedImage[]): FigmaImageAsset[] {
  return images.map((image) => ({
    name: image.nodeName,
    imageRef: image.imageHash,
    width: image.width,
    height: image.height,
    nodeId: image.nodeId,
    part: image.propertyKey ?? image.nodeName,
  }));
}

function toSlotMetadataFromDetectedProperty(detected: IDetectedProperty): SlotMetadata {
  const dimensions =
    detected.width !== undefined && detected.height !== undefined
      ? inferImageDimensions({ name: detected.name, width: detected.width, height: detected.height })
      : undefined;

  return compactObject({
    key: detected.key,
    name: detected.name,
    description: detected.nodePath ? `Synced from Figma (${detected.nodePath}).` : 'Synced from Figma.',
    generic: detected.suggestedType,
    default: detected.defaultValue,
    type: slotTypeFromDetectedProperty(detected),
    rules: compactObject({
      dimensions: detected.suggestedType === IMAGE_SLOT_TYPE ? dimensions : undefined,
    }),
  }) as SlotMetadata;
}

function mergeDetectedPropertiesIntoProperties(
  properties: Record<string, SlotMetadata> | undefined,
  detectedProperties: IDetectedProperty[]
): Record<string, SlotMetadata> {
  const next: Record<string, SlotMetadata> = { ...(properties ?? {}) };

  for (const detected of detectedProperties) {
    const slotKey = toSlotKey(detected.key || detected.name, `property${Object.keys(next).length + 1}`);
    const incoming = toSlotMetadataFromDetectedProperty(detected);
    const existing = next[slotKey];
    if (!existing) {
      next[slotKey] = { ...incoming, key: slotKey };
      continue;
    }

    const incomingDimensions = incoming.rules?.dimensions;
    next[slotKey] = {
      ...incoming,
      ...existing,
      key: slotKey,
      name: existing.name || incoming.name,
      description: existing.description || incoming.description,
      generic: existing.generic || incoming.generic,
      default: existing.default ?? incoming.default,
      rules: {
        ...(incoming.rules ?? {}),
        ...(existing.rules ?? {}),
        dimensions: existing.rules?.dimensions ?? incomingDimensions,
      },
    };
  }

  return next;
}

function mergeImageRulesIntoProperties(
  properties: Record<string, SlotMetadata> | undefined,
  images: FigmaImageAsset[] = []
): Record<string, SlotMetadata> | undefined {
  if (!properties || images.length === 0) return properties;
  const next: Record<string, SlotMetadata> = { ...properties };
  const unused = [...images];

  for (const [key, property] of Object.entries(properties)) {
    if (property?.type !== IMAGE_SLOT_TYPE) continue;

    const exact = unused.find((image) => {
      const haystacks = [image.name, image.part, image.role].filter(Boolean).map((value) => slugify(String(value)));
      return haystacks.includes(slugify(key));
    });
    const match = exact ?? unused[0];
    const dimensions = property.rules?.dimensions ?? (match ? inferImageDimensions(match) : undefined);
    if (!match || !dimensions) continue;

    const prevDefault =
      property.default && typeof property.default === 'object' && !Array.isArray(property.default)
        ? (property.default as Record<string, unknown>)
        : {};
    const imageSrc =
      typeof match.url === 'string' && match.url.trim()
        ? match.url
        : typeof prevDefault.src === 'string'
          ? prevDefault.src
          : '';

    next[key] = {
      ...property,
      default: { ...prevDefault, src: imageSrc },
      rules: { ...(property.rules ?? {}), dimensions },
    };
    const usedIndex = unused.indexOf(match);
    if (usedIndex >= 0) unused.splice(usedIndex, 1);
  }

  return next;
}

function getBaseComponentData(
  runtimeComponent: ComponentObject | ComponentListObject | TransformComponentTokensResult | undefined | null,
  builtComponent: TransformComponentTokensResult | null,
  componentId: string
): TransformComponentTokensResult {
  return {
    title: builtComponent?.title ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.title ?? componentId,
    description: builtComponent?.description ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.description ?? '',
    image: builtComponent?.image ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.image ?? '',
    group: builtComponent?.group ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.group ?? '',
    format: builtComponent?.format ?? 'html',
    code: builtComponent?.code ?? '',
    preview: builtComponent?.preview ?? '',
    html: builtComponent?.html,
    properties: builtComponent?.properties ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.properties ?? {},
    previews: builtComponent?.previews ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.previews ?? {},
    ...runtimeComponent,
    ...builtComponent,
    id: componentId,
    type: (builtComponent?.type ?? (runtimeComponent as TransformComponentTokensResult | undefined)?.type ?? 'element') as TransformComponentTokensResult['type'],
  };
}

function toComponentSummary(componentId: string, data: TransformComponentTokensResult): ComponentListObject {
  return {
    id: componentId,
    title: data.title,
    description: data.description,
    type: data.type,
    group: data.group,
    image: data.image ? data.image : '',
    figma: data.figma ? data.figma : '',
    figmaComponentId: data.figmaComponentId,
    figmaComponentKey: data.figmaComponentKey,
    figmaPublishedComponentKeys: data.figmaPublishedComponentKeys,
    figmaFileKey: data.figmaFileKey,
    figmaNodeId: data.figmaNodeId,
    figmaComponentSetId: data.figmaComponentSetId,
    figmaComponentSetName: data.figmaComponentSetName,
    figmaComponentName: data.figmaComponentName,
    figmaDescription: data.figmaDescription,
    figmaThumbnailUrl: data.figmaThumbnailUrl,
    figmaUpdatedAt: data.figmaUpdatedAt,
    figmaVariantSchema: data.figmaVariantSchema,
    figmaVariantLabel: data.figmaVariantLabel,
    figmaVariantValues: data.figmaVariantValues,
    figmaInstanceCount: data.figmaInstanceCount,
    figmaImages: data.figmaImages,
    figmaMatchStatus: data.figmaMatchStatus,
    figmaMatchedBy: data.figmaMatchedBy,
    figmaMissingMetadata: data.figmaMissingMetadata,
    categories: data.categories ? data.categories : [],
    tags: data.tags ? data.tags : [],
    properties: data.properties,
    previews: data.previews as Record<string, OptionalPreviewRender> | undefined,
    path: `${process.env.HANDOFF_APP_BASE_PATH ?? ''}/api/component/${componentId}.json`,
  };
}

async function updatePublicComponentSummary(summary: ComponentListObject): Promise<void> {
  const filePath = componentSummaryPath();
  const existing = (await readJsonIfExists<ComponentListObject[]>(filePath)) ?? [];
  const filtered = existing.filter((entry) => entry.id !== summary.id);
  const next = [...filtered, summary].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(next, null, 2));
}

function getConfiguredFigmaFileKey(): string | null {
  const fromEnv = process.env.HANDOFF_FIGMA_PROJECT_ID?.trim();
  return fromEnv || null;
}

async function getFigmaAccessTokenForSync(): Promise<string | null> {
  const dev = process.env.HANDOFF_DEV_ACCESS_TOKEN?.trim();
  if (dev) return /^Bearer\s+/i.test(dev) ? dev : `Bearer ${dev}`;
  return null;
}

async function downloadFigmaImagesToPublicApiComponent(
  componentId: string,
  fileKey: string,
  images: FigmaImageAsset[] | undefined,
  accessToken: string
): Promise<FigmaImageAsset[]> {
  if (!images?.length || !fileKey?.trim()) return images ?? [];

  const nodeIds = images.map((img) => img.nodeId).filter((id): id is string => Boolean(id));
  if (!nodeIds.length) return images;

  const urls = await fetchFigmaRasterExportUrls(fileKey, nodeIds, accessToken, { format: 'png', scale: 2 });
  const publicDir = path.join(getPublicApiDir(), 'component');
  await mkdir(publicDir, { recursive: true });

  const out: FigmaImageAsset[] = [];
  let fallbackIdx = 0;
  for (const img of images) {
    if (!img.nodeId) {
      out.push(img);
      continue;
    }
    const remote = urls[img.nodeId];
    if (!remote) {
      out.push(img);
      continue;
    }
    try {
      const res = await fetch(remote);
      if (!res.ok) {
        out.push(img);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const safeName = slugify(img.name || img.part || `image-${++fallbackIdx}`) || `image-${fallbackIdx}`;
      const filename = `${componentId}-${safeName}.png`;
      await writeFile(path.join(publicDir, filename), buf);
      out.push({ ...img, url: `/api/component/${filename}` });
    } catch {
      out.push(img);
    }
  }
  return out;
}

async function resolveComponentForPluginPush(payload: PushComponentPropertiesRequest): Promise<PluginComponentMatch | null> {
  const components = await listComponentsForPluginMatch();

  const requestedId = String(payload.handoffComponentId ?? '').trim();
  if (requestedId) {
    const existing = components.find((component) => component.id === requestedId);
    if (existing) {
      return { componentId: existing.id, matchedBy: 'handoff_component_id' };
    }
  }

  const figmaComponentKey = String(payload.figmaComponentKey ?? '').trim();
  if (figmaComponentKey) {
    const existing = components.find(
      (component) =>
        component.figmaComponentKey === figmaComponentKey || component.figmaPublishedComponentKeys?.includes(figmaComponentKey)
    );
    if (existing) {
      return { componentId: existing.id, matchedBy: 'figma_component_key' };
    }
  }

  const componentSetId = String(payload.componentSetId ?? '').trim();
  if (componentSetId) {
    const existing = components.find((component) => component.figmaComponentSetId === componentSetId);
    if (existing) {
      return { componentId: existing.id, matchedBy: 'component_set_id' };
    }
  }

  return null;
}

/** Plugin push handler kept free of figma-sync-service so App Routes avoid Turbopack NFT over-tracing. */
export async function pushPluginComponentProperties(
  payload: PushComponentPropertiesRequest
): Promise<PushComponentPropertiesResponse> {
  const match = await resolveComponentForPluginPush(payload);
  if (!match) {
    throw new Error('No Handoff component matched the plugin payload.');
  }

  const runtimeComponent = await getRuntimeComponent(match.componentId);
  const builtComponent = await readPublicComponentApi(match.componentId);
  if (!runtimeComponent && !builtComponent) {
    throw new Error(`Component "${match.componentId}" was not found.`);
  }

  const base = getBaseComponentData(runtimeComponent, builtComponent, match.componentId);
  const pluginImages = toFigmaImageAssets(payload.images);
  const mergedImages = mergeFigmaImages(base.figmaImages ?? [], pluginImages);
  const accessToken = await getFigmaAccessTokenForSync();
  const fileKey = base.figmaFileKey ?? getConfiguredFigmaFileKey() ?? undefined;
  let finalImages = mergedImages;
  if (accessToken && fileKey && finalImages.length > 0) {
    finalImages = await downloadFigmaImagesToPublicApiComponent(match.componentId, fileKey, finalImages, accessToken);
  }
  const mergedProperties = mergeDetectedPropertiesIntoProperties(base.properties, payload.properties);
  const next: TransformComponentTokensResult = {
    ...base,
    figmaImages: finalImages,
    properties: mergeImageRulesIntoProperties(mergedProperties, finalImages),
    image: base.image || base.figmaThumbnailUrl || '',
  };

  await writePublicComponentApi(match.componentId, next);
  const summary = toComponentSummary(match.componentId, next);
  await updatePublicComponentSummary(summary);

  return {
    ok: true,
    componentId: match.componentId,
    matchedBy: match.matchedBy ?? null,
    propertyCount: payload.properties.length,
    imageCount: payload.images.length,
    message: payload.images.length > 0 ? 'Plugin properties and image dimensions synced.' : 'Plugin properties synced.',
  };
}
