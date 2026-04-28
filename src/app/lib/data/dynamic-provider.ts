import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import type { SectionLink } from '../../components/util';
import { fetchDocPageMetadataAndContent, getClientRuntimeConfig, staticBuildMenu } from '../../components/util';
import { getDbComponents, getDbPatterns, getDbTokensSnapshot } from '../db/queries';
import type { DataProvider, DocPageContent } from './types';
import { StaticDataProvider } from './static-provider';

/**
 * DB-backed provider with progressive fallback to filesystem/static APIs.
 */
export class DynamicDataProvider implements DataProvider {
  private fallback = new StaticDataProvider();

  async getComponents(): Promise<ComponentListObject[]> {
    const rows = await getDbComponents();
    if (rows.length > 0) {
      return rows.map((r) => {
        if (r.data && typeof r.data === 'object') {
          return r.data as ComponentListObject;
        }
        return {
          id: r.id,
          path: r.path ?? `/${r.id}`,
          title: r.title,
          description: r.description ?? '',
          group: r.group ?? '',
          image: r.image ?? '',
          type: r.type ?? 'element',
          properties: (r.properties ?? {}) as ComponentObject['properties'],
          previews: (r.previews ?? {}) as ComponentObject['previews'],
        } as ComponentListObject;
      });
    }
    return this.fallback.getComponents();
  }

  async getComponent(id: string): Promise<ComponentObject | null> {
    const rows = await getDbComponents();
    const row = rows.find((r) => r.id === id);
    if (row?.data && typeof row.data === 'object') {
      return row.data as ComponentObject;
    }
    return this.fallback.getComponent(id);
  }

  async getPatterns(): Promise<PatternListObject[]> {
    const rows = await getDbPatterns();
    if (rows.length > 0) {
      return rows.map((r) => {
        if (r.data && typeof r.data === 'object') {
          return r.data as PatternListObject;
        }
        return {
          id: r.id,
          path: r.path ?? `/system/pattern/${r.id}`,
          title: r.title,
          description: r.description ?? '',
          group: r.group ?? '',
          tags: (r.tags as string[]) ?? [],
          components: (r.components as PatternObject['components']) ?? [],
        } as PatternListObject;
      });
    }
    return this.fallback.getPatterns();
  }

  async getPattern(id: string): Promise<PatternObject | null> {
    const rows = await getDbPatterns();
    const row = rows.find((r) => r.id === id);
    if (row?.data && typeof row.data === 'object') {
      return row.data as PatternObject;
    }
    return this.fallback.getPattern(id);
  }

  async getTokens(): Promise<CoreTypes.IDocumentationObject> {
    const snap = await getDbTokensSnapshot();
    if (snap) {
      return snap as CoreTypes.IDocumentationObject;
    }
    return this.fallback.getTokens();
  }

  async getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent> {
    // Future: read from `pages` table; for now same as static markdown resolution
    const { metadata, content, options } = fetchDocPageMetadataAndContent(localPath, slug);
    return {
      metadata: metadata as DocPageContent['metadata'],
      content: content ?? '',
      options: (options ?? {}) as DocPageContent['options'],
    };
  }

  getConfig(): ClientConfig {
    return getClientRuntimeConfig();
  }

  async getMenu(): Promise<SectionLink[]> {
    return staticBuildMenu();
  }
}
