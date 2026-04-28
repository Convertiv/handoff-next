import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import * as fs from 'fs-extra';
import path from 'path';
import { fetchDocPageMetadataAndContent, getClientRuntimeConfig, getTokens, staticBuildMenu } from '../../components/util';
import type { DataProvider, DocPageContent } from './types';
import type { SectionLink } from '../../components/util';

export function getPublicApiDir(): string {
  return path.resolve(
    process.env.HANDOFF_MODULE_PATH ?? '',
    '.handoff',
    process.env.HANDOFF_PROJECT_ID ?? '',
    'public',
    'api'
  );
}

export class StaticDataProvider implements DataProvider {
  async getComponents(): Promise<ComponentListObject[]> {
    const file = path.join(getPublicApiDir(), 'components.json');
    if (!fs.existsSync(file)) {
      return [];
    }
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as ComponentListObject[];
    } catch {
      return [];
    }
  }

  async getComponent(id: string): Promise<ComponentObject | null> {
    const file = path.join(getPublicApiDir(), 'component', `${id}.json`);
    if (!fs.existsSync(file)) {
      return null;
    }
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as ComponentObject;
    } catch {
      return null;
    }
  }

  async getPatterns(): Promise<PatternListObject[]> {
    const file = path.join(getPublicApiDir(), 'patterns.json');
    if (!fs.existsSync(file)) {
      return [];
    }
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as PatternListObject[];
    } catch {
      return [];
    }
  }

  async getPattern(id: string): Promise<PatternObject | null> {
    const file = path.join(getPublicApiDir(), 'pattern', `${id}.json`);
    if (!fs.existsSync(file)) {
      return null;
    }
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as PatternObject;
    } catch {
      return null;
    }
  }

  async getTokens(): Promise<CoreTypes.IDocumentationObject> {
    return getTokens();
  }

  async getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent> {
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

/** Summary list compatible with `fetchComponents()` shape used for static paths. */
export function componentSummariesFromList(list: ComponentListObject[]) {
  return list.map((c) => ({
    id: c.id,
    type: c.type || 'element',
    group: c.group || '',
    name: c.title || '',
    description: c.description || '',
  }));
}

/** Merge tokens + API list like legacy `fetchComponents()`. */
export async function getComponentIdsForStaticParams(): Promise<{ id: string }[]> {
  const fromTokens = getTokens()?.components ?? {};
  const apiList = await new StaticDataProvider().getComponents();
  const ids = new Set<string>(Object.keys(fromTokens));
  apiList.forEach((c) => ids.add(c.id));
  return [...ids].map((id) => ({ id }));
}
