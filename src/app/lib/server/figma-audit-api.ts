import 'server-only';

import {
  createFigmaAuditReport,
  getMissingFigmaMetadata,
  loadFigmaComponentCatalog,
  matchHandoffComponentToFigma,
  type FigmaChildComponentCatalogEntry,
} from '@handoff/figma/component-linking';
import type { ComponentListObject } from '@handoff/transformers/preview/types';
import { getDbComponents, getDbTokensSnapshot } from '@/lib/db/queries';
import type { FigmaAuditApiComponent, FigmaAuditApiResponse, FigmaAuditApiRow, LinkedFigmaFileInfo } from '@/lib/figma-sync-types';
import { getValidFigmaAccessTokenForUser, hasFigmaConnection } from '@/lib/server/figma-auth';
import { getPublicApiDir } from '@/lib/server/public-api-paths';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function withBearerToken(token: string | null | undefined): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function getConfiguredFigmaFileKey(): string | null {
  return process.env.HANDOFF_FIGMA_PROJECT_ID?.trim() || null;
}

function linkedFigmaFileUrl(fileKey: string): string {
  return `https://www.figma.com/file/${fileKey}`;
}

function titleFromTokensSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const name = (snapshot as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function fetchLiveFigmaFileTitle(userId: string, fileKey: string): Promise<string | null> {
  try {
    const accessToken = await getValidFigmaAccessTokenForUser(userId);
    const res = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { name?: string };
    return typeof json.name === 'string' && json.name.trim() ? json.name.trim() : null;
  } catch {
    return null;
  }
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

async function listComponentsForAudit(): Promise<ComponentListObject[]> {
  if (process.env.DATABASE_URL?.trim()) {
    const rows = await getDbComponents();
    return rows.map(componentListFromDbRow);
  }
  try {
    const raw = await readFile(path.join(getPublicApiDir(), 'components.json'), 'utf8');
    return JSON.parse(raw) as ComponentListObject[];
  } catch {
    return [];
  }
}

async function createCatalogLoaderContext(userId: string) {
  const documentationObject = await getDbTokensSnapshot();
  const projectId = process.env.HANDOFF_FIGMA_PROJECT_ID?.trim() || undefined;
  const oauthAccessToken = withBearerToken(await getValidFigmaAccessTokenForUser(userId).catch(() => null));
  const configAccessToken = withBearerToken(process.env.HANDOFF_DEV_ACCESS_TOKEN ?? null);
  return {
    config: {
      figma_project_id: projectId,
      figmaProjectId: projectId,
      dev_access_token: oauthAccessToken ?? configAccessToken ?? undefined,
    },
    async getDocumentationObject() {
      return documentationObject;
    },
  };
}

function buildChildRows(
  childEntries: FigmaChildComponentCatalogEntry[],
  components: ComponentListObject[],
  byId: Map<string, ComponentListObject>,
  componentMatches: Map<string, ReturnType<typeof matchHandoffComponentToFigma>>
): FigmaAuditApiRow[] {
  const linkedByChildKey = new Map<string, Array<{ component: ComponentListObject; match: ReturnType<typeof matchHandoffComponentToFigma> }>>();

  for (const component of components) {
    const match = componentMatches.get(component.id);
    if (!match?.child?.figmaComponentKey) continue;
    const current = linkedByChildKey.get(match.child.figmaComponentKey) ?? [];
    current.push({ component, match });
    linkedByChildKey.set(match.child.figmaComponentKey, current);
  }

  return childEntries
    .map((child): FigmaAuditApiRow => {
      const linked = linkedByChildKey.get(child.figmaComponentKey)?.[0];
      if (!linked) {
        return {
          figma: child,
          status: 'missing_in_handoff',
          matchedBy: null,
          missingMetadata: [],
          component: null,
        };
      }

      return {
        figma: child,
        status: linked.match.status === 'unlinked' ? 'unlinked' : 'matched',
        matchedBy: linked.match.matchedBy,
        missingMetadata: getMissingFigmaMetadata(linked.component, linked.match),
        component: byId.get(linked.component.id) ?? linked.component,
      };
    })
    .sort((a, b) => a.figma.figmaComponentName.localeCompare(b.figma.figmaComponentName));
}

/** Kept separate from figma-sync-service so App Routes avoid Turbopack NFT over-tracing. */
export async function getLinkedFigmaFileInfo(userId?: string): Promise<LinkedFigmaFileInfo | null> {
  const fileKey = getConfiguredFigmaFileKey();
  if (!fileKey) return null;

  const snapshotTitle = titleFromTokensSnapshot(await getDbTokensSnapshot());
  const liveTitle = userId ? await fetchLiveFigmaFileTitle(userId, fileKey) : null;

  return {
    fileKey,
    title: liveTitle || snapshotTitle || fileKey,
    url: linkedFigmaFileUrl(fileKey),
  };
}

export async function getFigmaAuditApiResponse(userId: string): Promise<FigmaAuditApiResponse> {
  const catalog = await loadFigmaComponentCatalog((await createCatalogLoaderContext(userId)) as never);
  const components = await listComponentsForAudit();
  const report = createFigmaAuditReport(components, catalog);
  const byId = new Map(components.map((component) => [component.id, component]));
  const componentMatches = new Map(components.map((component) => [component.id, matchHandoffComponentToFigma(component, catalog)]));
  const figmaComponents = buildChildRows(catalog.childEntries, components, byId, componentMatches);

  return {
    generatedAt: report.generatedAt,
    summary: {
      ...report.summary,
      figmaComponents: figmaComponents.length,
      matched: figmaComponents.filter((entry) => entry.status === 'matched').length,
      unlinked: figmaComponents.filter((entry) => entry.status === 'unlinked').length,
      missingInHandoff: figmaComponents.filter((entry) => entry.status === 'missing_in_handoff').length,
      metadataGaps: figmaComponents.filter((entry) => entry.missingMetadata.length > 0).length,
    },
    figmaComponents,
    components: report.components.map((entry): FigmaAuditApiComponent => ({
      ...entry,
      component: byId.get(entry.id) as ComponentListObject,
    })),
    connected: await hasFigmaConnection(userId),
    oauthConfigured: Boolean(process.env.AUTH_FIGMA_ID && process.env.AUTH_FIGMA_SECRET),
    linkedFile: await getLinkedFigmaFileInfo(userId),
  };
}
