import 'server-only';

import fs from 'fs-extra';
import path from 'path';
import {
  enrichComponentWithFigmaData,
  fetchFigmaRasterExportUrls,
  fetchNodeImages,
  fetchNodePropertySeeds,
  flattenNestedFigmaInRawDeclaration,
  loadFigmaComponentCatalog,
  matchHandoffComponentToFigma,
  mergeFigmaImages,
  mergeFigmaPreviewsIntoComponent,
  nestFigmaLinkDataForDeclarationFile,
  type FigmaImageAsset,
  type FigmaNodePropertySeed,
} from '@handoff/figma/component-linking';
import { slugify } from '@handoff/transformers/utils/string';
import type { ComponentListObject, ComponentObject, OptionalPreviewRender, TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { SlotType, type SlotMetadata } from '@handoff/transformers/preview/slots';
import type { IDetectedImage, IDetectedProperty, PushComponentPropertiesRequest, PushComponentPropertiesResponse } from '@/lib/figma-plugin-contract';
import { getValidFigmaAccessTokenForUser, hasFigmaConnection } from '@/lib/server/figma-auth';
import type { FigmaAuditApiResponse, FigmaSyncApiResponse, LinkedFigmaFileInfo } from '@/lib/figma-sync-types';
import { getDbTokensSnapshot } from '@/lib/db/queries';
import { getBuildJob, insertBuildJob, spawnComponentBuildWorker } from './component-builder';
import { evaluateTypeScriptDeclaration } from '@handoff/config/declaration-module-load';
import { getComponentExportProjectRoot, loadHandoffConfigFromDir } from './handoff-config-project';
import { getPublicApiDir } from './public-api-paths';

const COMPONENTS_DIR = 'components';
const IMAGE_SLOT_TYPE = 'image';

async function getDataProviderLazy() {
  const { getDataProvider } = await import('@/lib/data');
  return getDataProvider();
}

function resolveHandoffRepoRoot(): string {
  return getComponentExportProjectRoot();
}

function loadHandoffConfigFile(): ReturnType<typeof loadHandoffConfigFromDir> {
  return loadHandoffConfigFromDir(resolveHandoffRepoRoot());
}

type ImageDimensionRules = {
  width: number;
  height: number;
  min: { width: number; height: number };
  max: { width: number; height: number };
  recommend: { width: number; height: number };
};

type PluginComponentMatch = {
  componentId: string;
  matchedBy: PushComponentPropertiesResponse['matchedBy'];
};

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function withBearerToken(token: string | null | undefined): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function publicApiDir(): string {
  return getPublicApiDir();
}

function componentApiPath(componentId: string): string {
  return path.join(publicApiDir(), 'component', `${componentId}.json`);
}

function componentDeclarationPath(componentId: string): string {
  return path.join(toComponentDirAbs(componentId), `${componentId}.handoff.ts`);
}

function legacyComponentDeclarationJsonPath(componentId: string): string {
  return path.join(toComponentDirAbs(componentId), `${componentId}.handoff.json`);
}

function legacyComponentDeclarationCjsPath(componentId: string): string {
  return path.join(toComponentDirAbs(componentId), `${componentId}.handoff.cjs`);
}

function handoffModuleRootForDeclarations(): string {
  const mp = process.env.HANDOFF_MODULE_PATH?.trim();
  if (mp) return path.resolve(mp);
  return resolveHandoffRepoRoot();
}

function componentSummaryPath(): string {
  return path.join(publicApiDir(), 'components.json');
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!(await fs.pathExists(filePath))) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readPublicComponentApi(componentId: string): Promise<TransformComponentTokensResult | null> {
  return readJsonIfExists<TransformComponentTokensResult>(componentApiPath(componentId));
}

async function readPublicComponentSummary(componentId: string): Promise<ComponentListObject | null> {
  const list = await readJsonIfExists<ComponentListObject[]>(componentSummaryPath());
  return list?.find((entry) => entry.id === componentId) ?? null;
}

async function writePublicComponentApi(componentId: string, data: TransformComponentTokensResult): Promise<void> {
  const filePath = componentApiPath(componentId);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function readScaffoldDeclarationFile(componentId: string): Promise<Record<string, unknown> | null> {
  const tsPath = componentDeclarationPath(componentId);
  if (await fs.pathExists(tsPath)) {
    try {
      const mod = evaluateTypeScriptDeclaration(tsPath, handoffModuleRootForDeclarations()) as {
        default?: Record<string, unknown>;
      };
      const raw = mod.default ?? (mod as unknown as Record<string, unknown>);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return flattenNestedFigmaInRawDeclaration({ ...raw } as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  const jsonPath = legacyComponentDeclarationJsonPath(componentId);
  if (await fs.pathExists(jsonPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as Record<string, unknown>;
      return flattenNestedFigmaInRawDeclaration(raw);
    } catch {
      return null;
    }
  }

  const legacyPath = legacyComponentDeclarationCjsPath(componentId);
  if (!(await fs.pathExists(legacyPath))) return null;
  const source = await fs.readFile(legacyPath, 'utf8');
  const match = source.match(/^module\.exports\s*=\s*([\s\S]+);\s*$/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    return flattenNestedFigmaInRawDeclaration(raw);
  } catch {
    return null;
  }
}

async function writeScaffoldDeclarationFile(componentId: string, declaration: Record<string, unknown>): Promise<void> {
  const nested = nestFigmaLinkDataForDeclarationFile(declaration);
  await fs.writeFile(
    componentDeclarationPath(componentId),
    (await import('./component-scaffold')).buildHandoffDeclarationTsHandlebars(nested),
    'utf8'
  );
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
    previews: data.previews,
    path: `${process.env.HANDOFF_APP_BASE_PATH ?? ''}/api/component/${componentId}.json`,
  };
}

async function updatePublicComponentSummary(summary: ComponentListObject): Promise<void> {
  const filePath = componentSummaryPath();
  await fs.ensureDir(path.dirname(filePath));
  const existing = (await readJsonIfExists<ComponentListObject[]>(filePath)) ?? [];
  const filtered = existing.filter((entry) => entry.id !== summary.id);
  const next = [...filtered, summary].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  await fs.writeFile(filePath, JSON.stringify(next, null, 2));
}

function toComponentRootAbs(): string {
  return path.resolve(resolveHandoffRepoRoot(), COMPONENTS_DIR);
}

function toComponentDirAbs(componentId: string): string {
  return path.join(toComponentRootAbs(), componentId);
}

function toComponentRelPath(componentId: string): string {
  return `${COMPONENTS_DIR}/${componentId}`;
}

async function waitForBuildJob(jobId: number): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = 240_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getBuildJob(jobId);
    if (!job) return { ok: false, error: 'Build job missing' };
    if (job.status === 'complete') return { ok: true };
    if (job.status === 'failed') return { ok: false, error: job.error || 'Build failed' };
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return { ok: false, error: 'Build timed out.' };
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

function createFigmaImageProperties(images: FigmaImageAsset[] = []): Record<string, SlotMetadata> {
  const properties: Record<string, SlotMetadata> = {};
  const used = new Set<string>();

  for (const [index, image] of images.entries()) {
    const keyBase = toSlotKey(image.role || image.part || image.name, `image${index + 1}`);
    let key = keyBase;
    let suffix = 2;
    while (used.has(key)) {
      key = `${keyBase}${suffix++}`;
    }
    used.add(key);
    properties[key] = compactObject({
      name: image.name || key,
      description: `Image asset synced from Figma${image.part ? ` (${image.part})` : ''}.`,
      generic: 'image',
      type: IMAGE_SLOT_TYPE,
      default: {
        src: image.url ?? '',
        alt: image.name || key,
      },
      rules: compactObject({
        dimensions: inferImageDimensions(image),
      }),
    }) as SlotMetadata;
  }

  return properties;
}

function nodeSeedsToFigmaImages(seeds: FigmaNodePropertySeed[] = []): FigmaImageAsset[] {
  return seeds
    .filter((seed) => seed.suggestedType === IMAGE_SLOT_TYPE)
    .map((seed) => ({
      name: seed.name,
      width: seed.width,
      height: seed.height,
      part: seed.nodePath,
      role: 'image',
    }));
}

function mergeNodeSeedProperties(
  properties: Record<string, SlotMetadata> | undefined,
  seeds: FigmaNodePropertySeed[] = [],
  figmaImages: FigmaImageAsset[] = []
): Record<string, SlotMetadata> {
  const mergedImages = mergeFigmaImages(figmaImages, nodeSeedsToFigmaImages(seeds));
  const next: Record<string, SlotMetadata> = {
    ...createFigmaImageProperties(mergedImages),
    ...(properties ?? {}),
  };

  for (const seed of seeds) {
    if (seed.suggestedType !== 'text') continue;
    const keyBase = toSlotKey(seed.name || seed.key, seed.key || 'text');
    let key = keyBase;
    let suffix = 2;
    while (next[key]) {
      key = `${keyBase}${suffix++}`;
    }
    next[key] = compactObject({
      key,
      name: seed.name || key,
      description: `Text content synced from Figma${seed.nodePath ? ` (${seed.nodePath})` : ''}.`,
      generic: 'text',
      type: 'text',
      default: typeof seed.defaultValue === 'string' ? seed.defaultValue : '',
    }) as SlotMetadata;
  }

  return next;
}

function buildDefaultPreviewArgs(properties: Record<string, SlotMetadata> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, property]) => property.default !== undefined)
      .map(([key, property]) => [key, property.default as unknown])
  );
}

function mergeImageRulesIntoProperties(
  properties: Record<string, SlotMetadata> | undefined,
  images: FigmaImageAsset[] = []
) : Record<string, SlotMetadata> | undefined {
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
      default: {
        ...prevDefault,
        src: imageSrc,
      },
      rules: {
        ...(property.rules ?? {}),
        dimensions,
      },
    };
    const usedIndex = unused.indexOf(match);
    if (usedIndex >= 0) unused.splice(usedIndex, 1);
  }

  return next;
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
  await fs.ensureDir(publicDir);

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
      const imageRes = await fetch(remote);
      if (!imageRes.ok) {
        out.push(img);
        continue;
      }
      const buf = Buffer.from(await imageRes.arrayBuffer());
      const safe = slugify(img.nodeId.replace(/:/g, '-')) || `n${fallbackIdx++}`;
      const filename = `${componentId}-figma-${safe}.png`;
      await fs.writeFile(path.join(publicDir, filename), buf);
      out.push({ ...img, url: `/api/component/${filename}` });
    } catch {
      out.push(img);
    }
  }
  return out;
}

function defaultTemplateSource(componentId: string, title: string): string {
  return `<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <div class="${componentId}">
    <p>${title}</p>
  </div>
</body>
`;
}

function defaultScssSource(componentId: string): string {
  return `.${componentId} {\n  display: block;\n}\n`;
}

function defaultClientSource(): string {
  return `// Client hooks for this scaffolded component.\n`;
}

function toDeclarationPreviews(
  entry: FigmaChildComponentCatalogEntry,
  properties: Record<string, SlotMetadata>
): Record<string, { title: string; args: Record<string, unknown> }> {
  const fallbackArgs = buildDefaultPreviewArgs(properties);
  const previews = entry.previews.length > 0 ? entry.previews : [{ id: 'default', title: 'Default', values: fallbackArgs }];
  return Object.fromEntries(
    previews.map((preview) => [
      preview.id,
      {
        title: preview.title,
        args: preview.values,
      },
    ])
  );
}

function createScaffoldDeclaration(
  entry: FigmaChildComponentCatalogEntry,
  componentId: string,
  propertySeeds: FigmaNodePropertySeed[] = []
): Record<string, unknown> {
  const mergedImages = mergeFigmaImages(entry.figmaImages ?? [], nodeSeedsToFigmaImages(propertySeeds));
  const properties = mergeNodeSeedProperties(undefined, propertySeeds, mergedImages);
  return compactObject({
    id: componentId,
    name: entry.figmaComponentName,
    title: entry.figmaComponentName,
    description: entry.figmaDescription || `Synced from Figma component ${entry.figmaComponentName}.`,
    group: 'Synced from Figma',
    type: 'element',
    renderer: 'handlebars',
    image: entry.figmaThumbnailUrl,
    properties,
    previews: toDeclarationPreviews(entry, properties),
    figma: entry.figma,
    figmaComponentId: entry.slug,
    figmaComponentKey: entry.figmaComponentKey,
    figmaPublishedComponentKeys: entry.figmaPublishedComponentKeys,
    figmaFileKey: entry.figmaFileKey,
    figmaNodeId: entry.figmaNodeId,
    figmaComponentSetId: entry.figmaComponentSetId,
    figmaComponentSetName: entry.figmaComponentSetName,
    figmaComponentName: entry.figmaComponentName,
    figmaDescription: entry.figmaDescription,
    figmaThumbnailUrl: entry.figmaThumbnailUrl,
    figmaUpdatedAt: entry.figmaUpdatedAt,
    figmaVariantSchema: entry.figmaVariantSchema,
    figmaVariantLabel: entry.figmaVariantLabel,
    figmaVariantValues: entry.figmaVariantValues,
    figmaInstanceCount: entry.figmaInstanceCount,
    figmaImages: mergedImages,
    entries: {
      template: `./${componentId}.hbs`,
      scss: `./${componentId}.scss`,
      js: `./${componentId}.client.js`,
    },
  });
}

function createFallbackApiPayload(
  componentId: string,
  declaration: Record<string, unknown>
): TransformComponentTokensResult {
  const decl = flattenNestedFigmaInRawDeclaration({ ...declaration });
  const previews = (decl.previews ?? {}) as Record<string, { title?: string; args?: Record<string, unknown> }>;
  const previewMap: Record<string, OptionalPreviewRender> = Object.fromEntries(
    Object.entries(previews).map(([key, preview]) => [
      key,
      {
        title: preview.title || key,
        values: preview.args ?? {},
        url: '',
      },
    ])
  );

  return {
    id: componentId,
    title: String(decl.title ?? decl.name ?? componentId),
    description: String(decl.description ?? ''),
    image: typeof decl.image === 'string' ? decl.image : '',
    group: String(decl.group ?? ''),
    type: 'element' as TransformComponentTokensResult['type'],
    format: 'html',
    code: '',
    preview: '',
    html: '',
    figma: typeof decl.figma === 'string' ? decl.figma : '',
    figmaComponentId: typeof decl.figmaComponentId === 'string' ? decl.figmaComponentId : undefined,
    figmaComponentKey: typeof decl.figmaComponentKey === 'string' ? decl.figmaComponentKey : undefined,
    figmaPublishedComponentKeys: Array.isArray(decl.figmaPublishedComponentKeys)
      ? (decl.figmaPublishedComponentKeys as string[])
      : undefined,
    figmaFileKey: typeof decl.figmaFileKey === 'string' ? decl.figmaFileKey : undefined,
    figmaNodeId: typeof decl.figmaNodeId === 'string' ? decl.figmaNodeId : undefined,
    figmaComponentSetId: typeof decl.figmaComponentSetId === 'string' ? decl.figmaComponentSetId : undefined,
    figmaComponentSetName: typeof decl.figmaComponentSetName === 'string' ? decl.figmaComponentSetName : undefined,
    figmaComponentName: typeof decl.figmaComponentName === 'string' ? decl.figmaComponentName : undefined,
    figmaDescription: typeof decl.figmaDescription === 'string' ? decl.figmaDescription : undefined,
    figmaThumbnailUrl: typeof decl.figmaThumbnailUrl === 'string' ? decl.figmaThumbnailUrl : undefined,
    figmaUpdatedAt: typeof decl.figmaUpdatedAt === 'string' ? decl.figmaUpdatedAt : undefined,
    figmaVariantSchema: Array.isArray(decl.figmaVariantSchema) ? decl.figmaVariantSchema as TransformComponentTokensResult['figmaVariantSchema'] : undefined,
    figmaVariantLabel: typeof decl.figmaVariantLabel === 'string' ? decl.figmaVariantLabel : undefined,
    figmaVariantValues: decl.figmaVariantValues && typeof decl.figmaVariantValues === 'object'
      ? decl.figmaVariantValues as Record<string, string>
      : undefined,
    figmaInstanceCount: typeof decl.figmaInstanceCount === 'number' ? decl.figmaInstanceCount : undefined,
    figmaImages: Array.isArray(decl.figmaImages) ? decl.figmaImages as FigmaImageAsset[] : undefined,
    properties: (decl.properties as Record<string, SlotMetadata>) ?? {},
    previews: previewMap,
  };
}

function declarationPreviewsFromBuiltData(
  previews: Record<string, OptionalPreviewRender> | undefined
): Record<string, { title: string; args: Record<string, unknown> }> {
  return Object.fromEntries(
    Object.entries(previews ?? {}).map(([key, preview]) => [
      key,
      {
        title: preview.title || key,
        args: (preview.values ?? {}) as Record<string, unknown>,
      },
    ])
  );
}

async function createCatalogLoaderContext(userId?: string) {
  const provider = await getDataProviderLazy();
  const documentationObject = await provider.getTokens();
  const loaded = loadHandoffConfigFile();
  const projectId =
    process.env.HANDOFF_FIGMA_PROJECT_ID?.trim() ||
    loaded?.config?.figma_project_id ||
    loaded?.config?.figmaProjectId ||
    undefined;
  const oauthAccessToken = userId ? withBearerToken(await getValidFigmaAccessTokenForUser(userId).catch(() => null)) : null;
  const configAccessToken = withBearerToken(
    (typeof process.env.HANDOFF_DEV_ACCESS_TOKEN === 'string' ? process.env.HANDOFF_DEV_ACCESS_TOKEN : null) ||
      loaded?.config?.dev_access_token
  );
  return {
    config: {
      ...(loaded?.config ?? {}),
      figma_project_id: projectId ?? loaded?.config?.figma_project_id,
      figmaProjectId: projectId ?? loaded?.config?.figmaProjectId,
      dev_access_token: oauthAccessToken ?? configAccessToken ?? loaded?.config?.dev_access_token,
    },
    async getDocumentationObject() {
      return documentationObject;
    },
  };
}

function getConfiguredFigmaFileKey(): string | null {
  const fromEnv = process.env.HANDOFF_FIGMA_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

async function getFigmaAccessTokenForSync(userId?: string): Promise<string | null> {
  const oauthToken = userId ? withBearerToken(await getValidFigmaAccessTokenForUser(userId).catch(() => null)) : null;
  if (oauthToken) return oauthToken;

  const loaded = loadHandoffConfigFile();
  return withBearerToken(
    (typeof process.env.HANDOFF_DEV_ACCESS_TOKEN === 'string' ? process.env.HANDOFF_DEV_ACCESS_TOKEN : null) ||
      loaded?.config?.dev_access_token
  );
}

async function mergeFetchedNodeImages<T extends { figmaFileKey?: string; figmaNodeId?: string; figmaImages?: FigmaImageAsset[] }>(
  value: T,
  userId?: string
): Promise<T> {
  const fileKey = value.figmaFileKey ?? getConfiguredFigmaFileKey() ?? undefined;
  const nodeId = value.figmaNodeId;
  const accessToken = await getFigmaAccessTokenForSync(userId);
  if (!fileKey || !nodeId || !accessToken) return value;

  const nodeImages = await fetchNodeImages(fileKey, nodeId, accessToken);
  if (nodeImages.length === 0) return value;

  return {
    ...value,
    figmaImages: mergeFigmaImages(value.figmaImages ?? [], nodeImages),
  };
}

async function fetchNodePropertySeedsForValue(
  value: { figmaFileKey?: string; figmaNodeId?: string },
  userId?: string
): Promise<FigmaNodePropertySeed[]> {
  const fileKey = value.figmaFileKey ?? getConfiguredFigmaFileKey() ?? undefined;
  const nodeId = value.figmaNodeId;
  const accessToken = await getFigmaAccessTokenForSync(userId);
  if (!fileKey || !nodeId || !accessToken) return [];
  return fetchNodePropertySeeds(fileKey, nodeId, accessToken);
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

async function resolveComponentForPluginPush(payload: PushComponentPropertiesRequest): Promise<PluginComponentMatch | null> {
  const provider = await getDataProviderLazy();
  const components = await provider.getComponents();

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

export async function getLinkedFigmaFileInfo(userId?: string): Promise<LinkedFigmaFileInfo | null> {
  const { getLinkedFigmaFileInfo: load } = await import('./figma-audit-api');
  return load(userId);
}

export async function getFigmaAuditApiResponse(userId: string): Promise<FigmaAuditApiResponse> {
  const { getFigmaAuditApiResponse: load } = await import('./figma-audit-api');
  return load(userId);
}

async function ensureConfigIncludesComponent(componentId: string): Promise<{ configPath: string; updated: boolean }> {
  const repoRoot = resolveHandoffRepoRoot();
  const existing = loadHandoffConfigFile();
  const configPath = existing?.configPath ?? path.join(repoRoot, 'handoff.config.json');
  const componentPath = toComponentRelPath(componentId);

  if (configPath.endsWith('.json')) {
    const config = existing?.config ?? {};
    if (!config.entries) config.entries = {};
    const current = Array.isArray(config.entries.components) ? config.entries.components.map(String) : [];
    const autoLoadsAll = current.includes(COMPONENTS_DIR);
    if (!autoLoadsAll && !current.includes(componentPath)) {
      config.entries.components = [...current, componentPath];
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { configPath, updated: true };
    }
    if (!existing) {
      config.entries.components = current.length > 0 ? current : [componentPath];
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { configPath, updated: true };
    }
    return { configPath, updated: false };
  }

  if (!existing) {
    await fs.writeJSON(configPath, { entries: { components: [componentPath] } }, { spaces: 2 });
    return { configPath, updated: true };
  }

  const content = await fs.readFile(configPath, 'utf8');
  if (content.includes(`'${COMPONENTS_DIR}'`) || content.includes(`"${COMPONENTS_DIR}"`) || content.includes(`'${componentPath}'`) || content.includes(`"${componentPath}"`)) {
    return { configPath, updated: false };
  }

  const arrayMatch = content.match(/components\s*:\s*\[([\s\S]*?)\]/m);
  if (arrayMatch) {
    const nextArray = arrayMatch[0].replace(/\]$/, `${arrayMatch[1].trim() ? ',' : ''}\n      '${componentPath}'\n    ]`);
    await fs.writeFile(configPath, content.replace(arrayMatch[0], nextArray), 'utf8');
    return { configPath, updated: true };
  }

  const insertBlock = `  entries: {\n    components: ['${componentPath}'],\n  },\n`;
  if (content.includes('module.exports = {')) {
    await fs.writeFile(configPath, content.replace(/module\.exports\s*=\s*\{/, `module.exports = {\n${insertBlock}`), 'utf8');
    return { configPath, updated: true };
  }
  if (/export\s+default\s+\{/.test(content)) {
    await fs.writeFile(configPath, content.replace(/export\s+default\s+\{/, `export default {\n${insertBlock}`), 'utf8');
    return { configPath, updated: true };
  }
  if (/defineConfig\s*\(\s*\{/.test(content)) {
    await fs.writeFile(configPath, content.replace(/defineConfig\s*\(\s*\{/, `defineConfig({\n${insertBlock}`), 'utf8');
    return { configPath, updated: true };
  }

  throw new Error(`Unable to update ${path.basename(configPath)} automatically. Add "${componentPath}" to entries.components.`);
}

async function writeScaffoldFiles(
  entry: FigmaChildComponentCatalogEntry,
  componentId: string,
  propertySeeds: FigmaNodePropertySeed[] = []
): Promise<string[]> {
  const componentDir = toComponentDirAbs(componentId);
  await fs.ensureDir(componentDir);

  const declaration = createScaffoldDeclaration(entry, componentId, propertySeeds);
  await writeScaffoldDeclarationFile(componentId, declaration);

  const files: Array<[string, string]> = [
    [path.join(componentDir, `${componentId}.hbs`), defaultTemplateSource(componentId, entry.figmaComponentName)],
    [path.join(componentDir, `${componentId}.scss`), defaultScssSource(componentId)],
    [path.join(componentDir, `${componentId}.client.js`), defaultClientSource()],
  ];

  await Promise.all(files.map(([filePath, contents]) => fs.writeFile(filePath, contents, 'utf8')));
  return [componentDeclarationPath(componentId), ...files.map(([filePath]) => filePath)];
}

async function rebuildScaffoldedComponent(componentId: string): Promise<{ success: boolean; error: string | null }> {
  try {
    const jobId = await insertBuildJob(componentId);
    spawnComponentBuildWorker(jobId);
    const result = await waitForBuildJob(jobId);
    if (!result.ok) {
      return { success: false, error: result.error ?? 'Build failed' };
    }
    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Build failed',
    };
  }
}

async function ensureFallbackArtifacts(componentId: string, declaration: Record<string, unknown>): Promise<ComponentListObject | null> {
  const payload = createFallbackApiPayload(componentId, declaration);
  await writePublicComponentApi(componentId, payload);
  const summary = toComponentSummary(componentId, payload);
  await updatePublicComponentSummary(summary);
  return summary;
}

async function updateScaffoldedDeclarationFromBuiltData(componentId: string, data: TransformComponentTokensResult): Promise<boolean> {
  const existing = await readScaffoldDeclarationFile(componentId);
  if (!existing) return false;
  if (String(existing.group ?? '').trim() !== 'Synced from Figma') return false;

  const nextDeclaration = compactObject({
    ...existing,
    name: data.title || existing.name,
    title: data.title || existing.title,
    description: data.description,
    image: data.image,
    properties: data.properties,
    previews: declarationPreviewsFromBuiltData(data.previews),
    figma: data.figma,
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
  });

  await writeScaffoldDeclarationFile(componentId, nextDeclaration);
  return true;
}

function getBaseComponentData(
  runtimeComponent: ComponentObject | ComponentListObject | TransformComponentTokensResult | undefined,
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

export async function scaffoldFigmaComponent(
  componentId: string,
  userId: string,
  figmaComponentKey?: string,
  figmaSlug?: string
): Promise<FigmaSyncApiResponse> {
  const catalog = await loadFigmaComponentCatalog((await createCatalogLoaderContext(userId)) as never);
  const rawEntry =
    (figmaComponentKey ? catalog.byComponentKey.get(figmaComponentKey) : undefined) ??
    catalog.childEntries.find((item) => item.slug === (figmaSlug ?? componentId));
  if (!rawEntry) {
    throw new Error(`Figma component "${figmaComponentKey ?? figmaSlug ?? componentId}" was not found.`);
  }
  const entryMerged = await mergeFetchedNodeImages(rawEntry, userId);
  const accessToken = await getFigmaAccessTokenForSync(userId);
  let entry = entryMerged;
  if (accessToken && entryMerged.figmaFileKey && (entryMerged.figmaImages?.length ?? 0) > 0) {
    entry = {
      ...entryMerged,
      figmaImages: await downloadFigmaImagesToPublicApiComponent(
        componentId,
        entryMerged.figmaFileKey,
        entryMerged.figmaImages,
        accessToken
      ),
    };
  }
  const propertySeeds = await fetchNodePropertySeedsForValue(entry, userId);
  const existingSummary = await readPublicComponentSummary(componentId);
  if (existingSummary) {
    throw new Error(`Component "${componentId}" already exists.`);
  }

  const createdFiles = await writeScaffoldFiles(entry, componentId, propertySeeds);
  const configResult = await ensureConfigIncludesComponent(componentId);
  const declaration = createScaffoldDeclaration(entry, componentId, propertySeeds);

  const build = await rebuildScaffoldedComponent(componentId);
  let summary = await readPublicComponentSummary(componentId);
  if (!summary) {
    summary = await ensureFallbackArtifacts(componentId, declaration);
  }

  return {
    ok: true,
    action: 'create_component',
    componentId,
    figmaComponentKey: entry.figmaComponentKey,
    figmaSlug: entry.slug,
    createdFiles,
    configPath: configResult.configPath,
    configUpdated: configResult.updated,
    buildSucceeded: build.success,
    buildError: build.error,
    summary,
    message: build.success ? 'Component scaffold created from Figma.' : 'Component scaffold created, but the first build failed.',
  };
}

export async function syncFigmaMetadataIntoComponent(
  componentId: string,
  userId: string,
  figmaComponentKey?: string
): Promise<FigmaSyncApiResponse> {
  const provider = await getDataProviderLazy();
  const runtimeComponent = await provider.getComponent(componentId);
  const builtComponent = await readPublicComponentApi(componentId);
  if (!runtimeComponent && !builtComponent) {
    throw new Error(`Component "${componentId}" was not found.`);
  }

  const catalog = await loadFigmaComponentCatalog((await createCatalogLoaderContext(userId)) as never);
  const base = getBaseComponentData(runtimeComponent, builtComponent, componentId);
  if (figmaComponentKey) {
    base.figmaComponentKey = figmaComponentKey;
  }
  const match = matchHandoffComponentToFigma(base, catalog);
  if (!match.entry) {
    throw new Error(`No Figma match found for component "${componentId}".`);
  }

  const enriched = await mergeFetchedNodeImages(enrichComponentWithFigmaData(mergeFigmaPreviewsIntoComponent(base, match), match), userId);
  const propertySeeds = await fetchNodePropertySeedsForValue(enriched, userId);
  const mergedImagesBase = mergeFigmaImages(enriched.figmaImages ?? [], nodeSeedsToFigmaImages(propertySeeds));
  const accessToken = await getFigmaAccessTokenForSync(userId);
  let mergedImages = mergedImagesBase;
  if (accessToken && enriched.figmaFileKey && mergedImagesBase.length > 0) {
    mergedImages = await downloadFigmaImagesToPublicApiComponent(
      componentId,
      enriched.figmaFileKey,
      mergedImagesBase,
      accessToken
    );
  }
  const next: TransformComponentTokensResult = {
    ...enriched,
    figmaImages: mergedImages,
    image: enriched.image || enriched.figmaThumbnailUrl || '',
    properties: mergeImageRulesIntoProperties(
      mergeNodeSeedProperties(enriched.properties, propertySeeds, mergedImages),
      mergedImages
    ),
  };

  await writePublicComponentApi(componentId, next);
  await updateScaffoldedDeclarationFromBuiltData(componentId, next);
  const summary = toComponentSummary(componentId, next);
  await updatePublicComponentSummary(summary);

  return {
    ok: true,
    action: 'sync_metadata',
    componentId,
    figmaComponentKey: match.child?.figmaComponentKey,
    figmaSlug: match.child?.slug ?? match.entry.slug,
    buildSucceeded: true,
    buildError: null,
    summary,
    message: next.figmaImages?.length ? 'Figma metadata and image dimensions synced.' : 'Figma metadata synced.',
  };
}

export async function pushPluginComponentProperties(
  payload: PushComponentPropertiesRequest
): Promise<PushComponentPropertiesResponse> {
  const { pushPluginComponentProperties: push } = await import('./figma-plugin-properties-sync');
  return push(payload);
}
