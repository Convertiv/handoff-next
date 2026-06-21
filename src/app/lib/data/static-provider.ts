import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import * as fs from 'fs-extra';
import path from 'path';
import { fetchDocPageMetadataAndContent, getClientRuntimeConfig, getTokens, staticBuildMenu } from '../../components/util';
import type { DataProvider, DocPageContent, DtcgManifest, DtcgTokenStrings, DtcgTokenType } from './types';
import type { SectionLink } from '../../components/util';
import { getComponentDistDir, getPublicApiDir } from '../server/public-api-paths';
import { injectSystemUtilityLinks } from './menu-merge';

export { getPublicApiDir } from '../server/public-api-paths';

function filterCssLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `:root {\n${lines.join('\n')}\n}`;
}

function filterScssLines(content: string, prefix: string): string {
  return content.split('\n').filter((l) => l.trim().startsWith(`$${prefix}`)).join('\n');
}

function filterTailwindLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `@theme {\n${lines.join('\n')}\n}`;
}

// Workspace mode only — reads from filesystem, zero database access.
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
    const file = path.join(getComponentDistDir(id), `${id}.json`);
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

  async getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null> {
    try {
      const workingPath = process.env.HANDOFF_WORKING_PATH;
      const base = workingPath ? path.resolve(workingPath, 'design-system', 'dist') : path.resolve(process.cwd(), 'design-system', 'dist');
      const cssPath      = path.join(base, 'css', 'tokens.css');
      const scssPath     = path.join(base, 'scss', '_tokens.scss');
      const tailwindPath = path.join(base, 'tailwind', 'theme.css');
      const dtcgPath     = path.join(base, 'dtcg', 'tokens.resolved.json');
      if (![cssPath, scssPath, tailwindPath, dtcgPath].every((p) => fs.existsSync(p))) return null;
      const cssRaw      = await fs.readFile(cssPath, 'utf-8');
      const scssRaw     = await fs.readFile(scssPath, 'utf-8');
      const tailwindRaw = await fs.readFile(tailwindPath, 'utf-8');
      const dtcgRaw     = JSON.parse(await fs.readFile(dtcgPath, 'utf-8')) as Record<string, unknown>;
      return {
        css:      filterCssLines(cssRaw, type),
        scss:     filterScssLines(scssRaw, type),
        tailwind: filterTailwindLines(tailwindRaw, type),
        dtcg:     JSON.stringify(dtcgRaw[type] ?? {}, null, 2),
      };
    } catch {
      return null;
    }
  }

  async getDtcgManifest(): Promise<DtcgManifest | null> {
    try {
      const workingPath = process.env.HANDOFF_WORKING_PATH;
      const dsRoot = workingPath ? path.resolve(workingPath, 'design-system') : path.resolve(process.cwd(), 'design-system');
      const manifestPath = path.join(dsRoot, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      return JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as DtcgManifest;
    } catch {
      return null;
    }
  }

  async getDtcgBrands(): Promise<import('./types').DtcgBrandTokens | null> {
    try {
      const workingPath = process.env.HANDOFF_WORKING_PATH;
      const dsRoot = workingPath ? path.resolve(workingPath, 'design-system') : path.resolve(process.cwd(), 'design-system');
      const brandsDir = path.join(dsRoot, 'tokens', 'brands');
      const sharedGray = path.join(dsRoot, 'tokens', 'shared', 'gray.tokens.json');
      if (!fs.existsSync(brandsDir)) return null;
      const result: import('./types').DtcgBrandTokens = {};
      if (fs.existsSync(sharedGray)) {
        result['shared'] = JSON.parse(await fs.readFile(sharedGray, 'utf-8'));
      }
      for (const entry of await fs.readdir(brandsDir)) {
        if (!entry.endsWith('.tokens.json')) continue;
        const brand = entry.replace(/\.tokens\.json$/, '');
        result[brand] = JSON.parse(await fs.readFile(path.join(brandsDir, entry), 'utf-8'));
      }
      return Object.keys(result).length > 0 ? result : null;
    } catch {
      return null;
    }
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

  async getComponentSummaries(): Promise<import('./types').ComponentMenuSummary[]> {
    // Primary path: works when CWD is the materialized Next app root (.handoff/app).
    let file = path.join(getPublicApiDir(), 'components.json');

    // Fallback: when running from the project root (not .handoff/app), try the workspace path.
    if (!fs.existsSync(file) && process.env.HANDOFF_WORKING_PATH) {
      const fallback = path.join(process.env.HANDOFF_WORKING_PATH, '.handoff', 'app', 'public', 'api', 'components.json');
      if (fs.existsSync(fallback)) file = fallback;
    }

    if (!fs.existsSync(file)) return [];
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf-8')) as import('@handoff/transformers/preview/types').ComponentListObject[];
      return raw.map((c) => ({
        id: c.id,
        type: c.type,
        group: c.group ?? '',
        name: c.title ?? '',
        description: c.description ?? '',
      }));
    } catch { return []; }
  }

  async getMenu(): Promise<SectionLink[]> {
    const basePath = (process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '').replace(/\/+$/, '');
    const summaries = await this.getComponentSummaries();
    return injectSystemUtilityLinks(staticBuildMenu(summaries), basePath);
  }

  async getIconCatalog(): Promise<import('./types').IconCatalog> {
    const workingPath = process.env.HANDOFF_WORKING_PATH;
    if (!workingPath) return [];
    const catalogPath = path.join(workingPath, 'icons', 'catalog.json');
    if (!fs.existsSync(catalogPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  async getLogoSet(): Promise<import('./types').LogoSet | null> {
    const workingPath = process.env.HANDOFF_WORKING_PATH;
    if (!workingPath) return null;
    const logoSetPath = path.join(workingPath, 'logos', 'logo-set.json');
    if (!fs.existsSync(logoSetPath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(logoSetPath, 'utf-8'));
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
    } catch { return null; }
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
