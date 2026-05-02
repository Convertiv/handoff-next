import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import * as fs from 'fs-extra';
import path from 'path';
import { fetchDocPageMetadataAndContent, getClientRuntimeConfig, getTokens, staticBuildMenu } from '../../components/util';
import type { DataProvider, DocPageContent } from './types';
import type { SectionLink } from '../../components/util';
import { getMaterializedAppRoot } from '../server/handoff-app-paths';

/**
 * Built JSON from `build:components` / pipeline: mirrored into `<HANDOFF_APP_ROOT>/public/api`
 * during materialization. Prefer that path in the Next runtime (Vercel serverless includes the
 * app tree, not always the repo working tree). Fall back to `<HANDOFF_WORKING_PATH>/public/api`.
 */
export function getPublicApiDir(): string {
  const appRoot = process.env.HANDOFF_APP_ROOT?.trim();
  if (appRoot && !appRoot.startsWith('%HANDOFF_')) {
    return path.resolve(appRoot, 'public', 'api');
  }
  const working = process.env.HANDOFF_WORKING_PATH?.trim();
  if (working && !working.startsWith('%HANDOFF_')) {
    return path.resolve(working, 'public', 'api');
  }
  const mod = process.env.HANDOFF_MODULE_PATH?.trim();
  const id = process.env.HANDOFF_PROJECT_ID?.trim();
  if (mod && id && !mod.startsWith('%HANDOFF_') && !id.startsWith('%HANDOFF_')) {
    const legacy = path.resolve(mod, '.handoff', id, 'public', 'api');
    if (fs.existsSync(legacy)) return legacy;
  }
  return path.resolve(getMaterializedAppRoot(), 'public', 'api');
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
