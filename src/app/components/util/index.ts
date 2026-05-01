import { ComponentListObject, ComponentType, PatternListObject } from '@handoff/transformers/preview/types';
import { ClientConfig, RuntimeConfig } from '@handoff/types/config';
import { ComponentDocumentationOptions, PreviewObject } from '@handoff/types/preview';
import { desc } from 'drizzle-orm';
import * as fs from 'fs-extra';
import matter from 'gray-matter';
import { Types as CoreTypes } from 'handoff-core';
import { groupBy, startCase, uniq } from 'lodash';
import path from 'path';
import { ParsedUrlQuery } from 'querystring';
import { getDb } from '../../lib/db';
import { getPublicApiDir } from '../../lib/data/static-provider';
import { handoffTokensSnapshots } from '../../lib/db/schema';
import { getMaterializedAppRoot } from '../../lib/server/handoff-app-paths';
// Get the parsed url string type
export interface IParams extends ParsedUrlQuery {
  slug: string | string[];
}

// Type for the metadata from frontmatter
export interface Metadata {
  title: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
}

// Define what a section link looks like
export interface SectionLink {
  title: string;
  weight: number;
  external?: string | boolean;
  path: string;
  subSections: {
    title: string;
    path: string;
    image: string;
    menu?: {
      title: string;
      path: string;
      image: string;
    }[];
  }[];
}
// Documentation Page Properties
export interface DocumentationProps {
  metadata: Metadata;
  content?: string;
  options?: ComponentDocumentationOptions;
  menu: SectionLink[];
  current: SectionLink;
  config: ClientConfig;
}

export interface DocumentationWithTokensProps extends DocumentationProps {
  css: string;
  scss: string;
  styleDictionary: string;
  types: string;
}

export interface FontDocumentationProps extends DocumentationProps {
  customFonts: string[];
  design: CoreTypes.IDocumentationObject['localStyles'];
}

export interface AssetDocumentationProps extends DocumentationProps {
  assets: CoreTypes.IDocumentationObject['assets'];
}

export interface ComponentDocumentationProps extends DocumentationWithTokensProps {
  id: string;
  component: CoreTypes.IFileComponentObject;
  // definitions: DocumentComponentDefinitions;
  previews: PreviewObject[];
  componentOptions: CoreTypes.IHandoffConfigurationComponentOptions;
}

export interface FoundationDocumentationProps extends DocumentationWithTokensProps {
  design: CoreTypes.IDocumentationObject['localStyles'];
}
/**
 * List the default paths
 */
/**
 * First URL segment that must not be handled by the markdown catch-all `app/[...slug]/page.tsx`
 * (those routes have their own `page.tsx` files or are app infrastructure).
 */
export const MARKDOWN_CATCHALL_RESERVED_FIRST_SEGMENTS = new Set([
  'api',
  '_next',
  'login',
  'reset-password',
  'admin',
  'assets',
  'foundations',
  'system',
  'design',
  'playground',
  'patterns',
]);

export const knownPaths = [
  'assets',
  'assets/fonts',
  'assets/icons',
  'assets/logos',
  'foundations',
  'foundations/colors',
  'foundations/icons',
  'foundations/effects',
  'foundations/logos',
  'foundations/logo',
  'foundations/typography',
  'system',
  'system/component',
  'system/tokens',
  'system/tokens/foundations',
  'system/tokens/foundations/colors',
  'system/tokens/foundations/effects',
  'system/tokens/foundations/typography',
  'system/tokens/components',
  'system/pattern',
  'design',
  'playground',
  'patterns',
];

/**
 * Get the plural name of a component
 * @param singular
 * @returns
 */
export const pluralizeComponent = (singular: string): string => {
  return (
    {
      button: 'buttons',
      select: 'selects',
      checkbox: 'checkboxes',
      radio: 'radios',
      input: 'inputs',
      tooltip: 'tooltips',
      alert: 'alerts',
      switch: 'switches',
      pagination: 'pagination',
      modal: 'modal',
    }[singular] ?? singular
  );
};

/**
 * Recursively collect all .md files from a directory, returning their
 * path segments relative to the root (without the .md extension).
 */
const collectMarkdownPaths = (rootDir: string, relativeParts: string[] = []): string[][] => {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir);
  const results: string[][] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry);
    if (fs.lstatSync(fullPath).isDirectory()) {
      results.push(...collectMarkdownPaths(fullPath, [...relativeParts, entry]));
    } else if (entry.endsWith('.md') && entry !== 'index.md') {
      results.push([...relativeParts, entry.replace('.md', '')]);
    }
  }
  return results;
};

/**
 * Build catch-all static paths for all markdown pages at any depth.
 * Excludes paths in knownPaths (those have dedicated route files).
 */
export const buildCatchAllStaticPaths = () => {
  const docRoot = path.resolve(process.env.HANDOFF_MODULE_PATH ?? '', 'config/docs');
  const pageRoot = path.resolve(process.env.HANDOFF_WORKING_PATH ?? '', 'pages');

  const docPaths = collectMarkdownPaths(docRoot);
  const pagePaths = collectMarkdownPaths(pageRoot);

  const seen = new Set<string>();
  const allPaths: string[][] = [];

  // Pages override docs (working copy wins)
  for (const segments of [...pagePaths, ...docPaths]) {
    const key = segments.join('/');
    if (!seen.has(key)) {
      seen.add(key);
      allPaths.push(segments);
    }
  }

  return allPaths.filter((segments) => knownPaths.indexOf(segments.join('/')) < 0).map((segments) => ({ params: { slug: segments } }));
};

/**
 * Recursively build menu entries from .md files in a directory.
 * Returns sub-section items with nested menu items for subdirectories.
 */
const buildMenuFromDirectory = (dirPath: string, urlPrefix: string): any[] => {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath);
  const items: any[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    if (fs.lstatSync(fullPath).isDirectory()) {
      const nestedItems = buildMenuFromDirectory(fullPath, `${urlPrefix}/${entry}`);
      if (nestedItems.length > 0) {
        items.push({
          title: startCase(entry),
          path: `${urlPrefix}/${entry}`,
          menu: nestedItems,
        });
      }
    } else if (entry.endsWith('.md') && entry !== 'index.md') {
      const slug = entry.replace('.md', '');
      const fullSlugPath = `${urlPrefix}/${slug}`.replace(/^\/+/, '');
      if (knownPaths.indexOf(fullSlugPath) >= 0) continue;

      const contents = fs.readFileSync(fullPath, 'utf-8');
      const { data: metadata } = matter(contents);
      if (metadata.enabled === false) continue;

      items.push({
        title: metadata.menuTitle ?? metadata.title ?? startCase(slug),
        path: `/${fullSlugPath}`,
        weight: metadata.weight ?? 0,
      });
    }
  }

  return items.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
};

/**
 * Build the static menu for rendering pages
 * @returns SectionLink[]
 */
export const staticBuildMenu = () => {
  const docRoot = path.join(process.env.HANDOFF_MODULE_PATH ?? '', 'config/docs');
  if (!fs.existsSync(docRoot)) {
    return [];
  }
  const files = fs.readdirSync(docRoot);
  let list = files;
  const workingPages = path.resolve(process.env.HANDOFF_WORKING_PATH ?? '', 'pages');
  let pages: string[] = [];
  if (fs.existsSync(workingPages)) {
    pages = fs.readdirSync(workingPages);
    list = list.concat(pages);
  }
  const sections: SectionLink[] = [];
  const custom = uniq(list)
    .map((fileName: string) => {
      let search = '';
      if (pages.includes(fileName)) {
        search = path.resolve(workingPages, fileName);
      } else {
        search = path.resolve(docRoot, fileName);
      }
      if (
        !fs.lstatSync(search).isDirectory() &&
        search !== path.resolve(docRoot, 'index.md') &&
        search !== path.resolve(workingPages, 'index.md') &&
        fileName.endsWith('md')
      ) {
        const contents = fs.readFileSync(search, 'utf-8');
        const { data: metadata } = matter(contents);
        if (metadata.enabled === false) {
          return undefined;
        }

        const filepath = `/${fileName.replace('.md', '')}`;
        let subSections = [];

        if (metadata.menu) {
          subSections = Object.keys(metadata.menu)
            .flatMap((key) => {
              const sub = metadata.menu[key];
              if (sub.components) {
                const componentMenuSections = staticBuildComponentMenu(sub.components);
                if (sub.components === true) {
                  return componentMenuSections;
                }
                return [{ title: sub.title, menu: componentMenuSections }];
              }
              if (sub.tokens) {
                return [{
                  title: 'Tokens',
                  menu: staticBuildTokensMenu(),
                }];
              }
              if (sub.patterns) {
                const patternMenu = staticBuildPatternMenu();
                if (patternMenu.length > 0) {
                  return [{
                    title: sub.title || 'Patterns',
                    menu: patternMenu,
                  }];
                }
                return [];
              }
              if (sub.enabled !== false) {
                return [sub];
              }
              return [];
            })
            .filter(filterOutUndefined);
        } else {
          // Only auto-scan directories when no frontmatter menu is defined
          const dirName = fileName.replace('.md', '');
          const docDir = path.resolve(docRoot, dirName);
          const pagesDir = path.resolve(workingPages, dirName);
          const nestedFromDocs = buildMenuFromDirectory(docDir, `/${dirName}`);
          const nestedFromPages = buildMenuFromDirectory(pagesDir, `/${dirName}`);

          const seenPaths = new Set<string>();
          for (const item of [...nestedFromPages, ...nestedFromDocs]) {
            if (item.path && !seenPaths.has(item.path)) {
              seenPaths.add(item.path);
              subSections.push(item);
            }
          }
        }

        let external: string | boolean = false;
        if (
          typeof metadata.external === 'string' &&
          (metadata.external.startsWith('http://') || metadata.external.startsWith('https://') || metadata.external.startsWith('/'))
        ) {
          external = metadata.external;
        }

        return {
          title: metadata.menuTitle ?? metadata.title,
          external,
          weight: metadata.weight ?? 0,
          path: `${filepath}`,
          subSections,
        };
      }
    })
    .filter(filterOutUndefined);
  return sections.concat(custom).sort((a: SectionLink, b: SectionLink) => a.weight - b.weight);
};

const buildBasePath = () => {
  if (!process.env.HANDOFF_APP_BASE_PATH) {
    return '';
  }
  return (process.env.HANDOFF_APP_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '') + '/';
};

const componentTypeMenuTitle = (type: string): string => {
  const normalized = String(type || '').toLowerCase();
  if (normalized === ComponentType.Element) return 'Elements';
  if (normalized === ComponentType.Block) return 'Blocks';
  if (normalized === ComponentType.Navigation) return 'Navigation';
  if (normalized === ComponentType.Utility) return 'Utility';
  return startCase(normalized || 'components');
};

const buildComponentGroupsMenu = (components: { id: string; name: string; group: string }[], basePath: string) => {
  let groups: { title: string; menu: { path: string; title: string }[] }[] = [];
  const groupedComponents = groupBy(components, (e) => e.group ?? '');
  Object.keys(groupedComponents).forEach((group) => {
    const menuGroup = { title: group || 'Uncategorized', menu: [] as { path: string; title: string }[] };
    groupedComponents[group].forEach((component) => {
      const docs = fetchDocPageMetadataAndContent('docs/system/', component.id);
      let title = startCase(component.id);
      if (docs.metadata.title) {
        title = docs.metadata.title;
      }
      if (component.name) {
        title = component.name;
      }
      menuGroup.menu.push({ path: `${basePath}system/component/${component.id}`, title });
    });
    menuGroup.menu = menuGroup.menu.sort((a, b) => a.title.localeCompare(b.title));
    groups.push(menuGroup);
  });
  groups = groups.sort((a, b) => a.title.localeCompare(b.title));
  return groups;
};

/** Summary shape used to build the Design System → Components sidebar (grouped by type and group). */
export type ComponentMenuSummary = { id: string; type?: string; group: string; name: string; description?: string };

/**
 * Build component sidebar sections from an explicit list (e.g. merged DB + static in dynamic mode).
 * Same layout rules as {@link fetchComponents}-based `staticBuildComponentMenu`.
 */
export const buildComponentSubmenusFromSummaries = (components: ComponentMenuSummary[], type?: boolean | string) => {
  const basePath = buildBasePath();
  let list = [...components];
  if (typeof type === 'string' && type !== '') {
    list = list.filter((component) => component.type == type);
    return buildComponentGroupsMenu(list, basePath);
  }

  if (type === true) {
    const groupedByType = groupBy(list, (component) => String(component.type || ComponentType.Element).toLowerCase());
    const desiredOrder = [ComponentType.Element, ComponentType.Block, ComponentType.Navigation, ComponentType.Utility];
    const sortedTypes = Object.keys(groupedByType).sort((a, b) => {
      const ai = desiredOrder.indexOf(a as ComponentType);
      const bi = desiredOrder.indexOf(b as ComponentType);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
    return sortedTypes
      .map((componentType) => ({
        title: componentTypeMenuTitle(componentType),
        menu: buildComponentGroupsMenu(groupedByType[componentType], basePath),
      }))
      .filter((section) => section.menu.length > 0);
  }

  return buildComponentGroupsMenu(list, basePath);
};

const staticBuildComponentMenu = (type?: boolean | string) => {
  const raw = fetchComponents({ includeTokens: false }) ?? [];
  const components: ComponentMenuSummary[] = raw.map((c) => ({
    id: c.id,
    type: c.type,
    group: c.group ?? '',
    name: c.name ?? '',
    description: c.description,
  }));
  return buildComponentSubmenusFromSummaries(components, type);
};

const staticBuildTokensMenu = () => {
  const basePath = buildBasePath();

  const menu = [
    {
      title: `Foundations`,
      path: `${basePath}system/tokens/foundations`,
      menu: [
        {
          title: `Colors`,
          path: `${basePath}system/tokens/foundations/colors`,
        },
        {
          title: `Effects`,
          path: `${basePath}system/tokens/foundations/effects`,
        },
        {
          title: `Typography`,
          path: `${basePath}system/tokens/foundations/typography`,
        },
      ],
    },
  ];

  const componentMenuItems = [];
  const components = fetchComponents({ includeApi: false });
  // Build the submenu of exportables (components)
  const groupedComponents = groupBy(components, (e) => e.group ?? '');
  Object.keys(groupedComponents).forEach((group) => {
    groupedComponents[group].forEach((component) => {
      const docs = fetchDocPageMetadataAndContent('docs/system/', component.id);
      let title = startCase(component.id);
      if (docs.metadata.title) {
        title = docs.metadata.title;
      }
      if (component.name) {
        title = component.name;
      }
      componentMenuItems.push({ path: `${basePath}system/tokens/components/${component.id}`, title });
    });
  });

  if (componentMenuItems.length > 0) {
    menu.push({
      title: `Components`,
      path: `${basePath}system/tokens/components`,
      menu: componentMenuItems,
    });
  }

  return menu;
};

const staticBuildTokenMenu = () => {
  const basePath = buildBasePath();

  let subSections = {
    title: 'Tokens',
    path: `${basePath}system/tokens`,
    menu: [],
  };
  const tokens = getTokens();

  return subSections;
};

/**
 * Fetch patterns from the patterns.json API file
 */
export const fetchPatterns = (): { id: string; title: string; description: string; group: string }[] => {
  const patternsFilePath = path.join(getPublicApiDir(), 'patterns.json');

  if (!fs.existsSync(patternsFilePath)) {
    return [];
  }

  try {
    const patternList = JSON.parse(fs.readFileSync(patternsFilePath, 'utf-8')) as PatternListObject[];

    return patternList.map((p) => ({
      id: p.id,
      title: p.title || '',
      description: p.description || '',
      group: p.group || '',
    }));
  } catch {
    return [];
  }
};

const staticBuildPatternMenu = () => {
  const basePath = buildBasePath();
  const patterns = fetchPatterns();

  if (patterns.length === 0) return [];

  const grouped = groupBy(patterns, (p) => p.group ?? '');
  let menu: { title: string; menu: { path: string; title: string }[] }[] = [];

  Object.keys(grouped).forEach((group) => {
    const menuGroup = { title: group || 'Uncategorized', menu: [] as { path: string; title: string }[] };
    grouped[group].forEach((pattern) => {
      menuGroup.menu.push({
        path: `${basePath}system/pattern/${pattern.id}`,
        title: pattern.title || startCase(pattern.id),
      });
    });
    menuGroup.menu.sort((a, b) => a.title.localeCompare(b.title));
    menu.push(menuGroup);
  });

  menu.sort((a, b) => a.title.localeCompare(b.title));
  return menu;
};

/**
 * Filter the menus by the current path
 * @param menu
 * @param path
 * @returns SectionLink | null
 */
export const getCurrentSection = (menu: SectionLink[], path: string): SectionLink | null =>
  menu.filter((section) => section.path === path)[0];

/**
 * Build a static object for rending markdown pages
 * @param path
 * @param slug
 * @returns
 */
export const fetchDocPageMarkdown = (
  path: string,
  slug: string | undefined,
  id: string,
  runtimeConfig?: RuntimeConfig,
  /** When set (e.g. merged DB + disk menu in dynamic mode), used instead of {@link staticBuildMenu}. */
  menuOverride?: SectionLink[]
) => {
  const menu = menuOverride ?? staticBuildMenu();
  const { metadata, content, options } = fetchDocPageMetadataAndContent(path, slug, runtimeConfig);
  // Return props
  return {
    props: {
      metadata,
      content,
      options,
      menu,
      current: getCurrentSection(menu, `${id}`) ?? null,
    },
  };
};

/** Same as {@link fetchDocPageMarkdown} but uses `getDataProvider().getMenu()` (merged DB + disk in dynamic mode). */
export async function fetchDocPageMarkdownAsync(path: string, slug: string | undefined, id: string, runtimeConfig?: RuntimeConfig) {
  const { getDataProvider } = await import('../../lib/data');
  const menu = await getDataProvider().getMenu();
  return fetchDocPageMarkdown(path, slug, id, runtimeConfig, menu);
}

/**
 * Fetch Component Doc Page Markdown
 * @param path
 * @param slug
 * @param id
 * @returns
 */
export const fetchCompDocPageMarkdown = (
  path: string,
  slug: string | undefined,
  id: string,
  runtimeConfig?: RuntimeConfig,
  menuOverride?: SectionLink[]
) => {
  return {
    props: {
      ...fetchDocPageMarkdown(path, slug, id, runtimeConfig, menuOverride).props,
      scss: slug ? fetchTokensString(slug, 'scss') : '',
      css: slug ? fetchTokensString(slug, 'css') : '',
      styleDictionary: slug ? fetchTokensString(slug, 'styleDictionary') : '',
      types: slug ? fetchTokensString(slug, 'types') : '',
    },
  };
};

export async function fetchCompDocPageMarkdownAsync(path: string, slug: string | undefined, id: string, runtimeConfig?: RuntimeConfig) {
  const { getDataProvider } = await import('../../lib/data');
  const menu = await getDataProvider().getMenu();
  return fetchCompDocPageMarkdown(path, slug, id, runtimeConfig, menu);
}

type FetchComponentsOptions = {
  includeTokens?: boolean;
  includeApi?: boolean;
};

/**
 * Fetch exportables id's from the JSON files in the exportables directory
 * @param options - Configuration object to specify which component sources to include
 * @param options.includeTokens - Include components from tokens.json (default: true)
 * @param options.includeApi - Include components from components.json API (default: true)
 * @returns {string[]} Array of component objects with id, type, group, name, and description
 */
export const fetchComponents = (options?: FetchComponentsOptions) => {
  const includeTokens = options?.includeTokens ?? true;
  const includeApi = options?.includeApi ?? true;

  let components: Record<
    string,
    Omit<CoreTypes.IFileComponentObject, 'instances'> & { type?: ComponentType; group?: string; description?: string; name?: string }
  > = {};

  // Include components from tokens.json if requested
  if (includeTokens) {
    const tokens = getTokens();
    components = tokens?.components ?? {};
  }

  // Include components from components.json API if requested
  if (includeApi) {
    const componentsFile = path.join(getPublicApiDir(), 'components.json');

    if (fs.existsSync(componentsFile)) {
      const componentList = JSON.parse(fs.readFileSync(componentsFile, 'utf-8')) as ComponentListObject[];

      componentList.forEach((component) => {
        components[component.id] = {
          type: (component.type as ComponentType) || ComponentType.Element,
          group: component.group || '',
          description: component.description || '',
          name: component.title || '',
        };
      });
    }
  }

  // Merge per-component JSON snapshots produced by DB-backed builds into the menu tree.
  const dynamicComponentDir = path.join(getPublicApiDir(), 'component');
  if (fs.existsSync(dynamicComponentDir)) {
    const componentFiles = fs.readdirSync(dynamicComponentDir).filter((f) => f.endsWith('.json'));
    componentFiles.forEach((fileName) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.resolve(dynamicComponentDir, fileName), 'utf-8')) as Partial<ComponentListObject>;
        const fileId = fileName.replace(/\.json$/, '');
        const id = typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : fileId;
        components[id] = {
          ...(components[id] ?? {}),
          type: ((parsed.type as ComponentType) || components[id]?.type || ComponentType.Element) as ComponentType,
          group: parsed.group || components[id]?.group || '',
          description: parsed.description || components[id]?.description || '',
          name: parsed.title || components[id]?.name || '',
        };
      } catch {
        // ignore malformed component artifact
      }
    });
  }

  const items =
    Object.entries(components).map(([id, obj]) => ({
      id,
      type: obj.type || 'Components',
      group: obj.group || '',
      name: obj.name || '',
      description: obj.description || '',
    })) ?? [];

  try {
    return items;
  } catch (e) {
    return null;
  }
};

type ClientConfigCache = { config: ClientConfig };

let cachedClientConfig: ClientConfigCache | null = null;

const getDefaultClientConfig = (): ClientConfigCache => {
  return {
    config: {} as ClientConfig,
  };
};

const loadClientConfig = (): ClientConfigCache => {
  if (cachedClientConfig) {
    return cachedClientConfig;
  }

  const clientConfigPath = path.join(getMaterializedAppRoot(), 'client.config.json');

  if (!fs.existsSync(clientConfigPath)) {
    // Return empty default instead of throwing to support running without fetch
    return getDefaultClientConfig();
  }

  try {
    const cacheContent = fs.readFileSync(clientConfigPath, 'utf-8');
    cachedClientConfig = JSON.parse(cacheContent) as ClientConfigCache;
    return cachedClientConfig;
  } catch (e) {
    // Return empty default on error instead of throwing
    return getDefaultClientConfig();
  }
};

/**
 * Fetch Component Doc Page Markdown
 * @param path
 * @param slug
 * @param id
 * @returns
 */
export const fetchFoundationDocPageMarkdown = (path: string, slug: string | undefined, id: string, menuOverride?: SectionLink[]) => {
  return {
    props: {
      ...fetchDocPageMarkdown(path, slug, id, undefined, menuOverride).props,
      scss: slug ? fetchTokensString(pluralizeComponent(slug), 'scss') : '',
      css: slug ? fetchTokensString(pluralizeComponent(slug), 'css') : '',
      styleDictionary: slug ? fetchTokensString(pluralizeComponent(slug), 'styleDictionary') : '',
      types: slug ? fetchTokensString(pluralizeComponent(slug), 'types') : '',
    },
  };
};

export async function fetchFoundationDocPageMarkdownAsync(path: string, slug: string | undefined, id: string) {
  const { getDataProvider } = await import('../../lib/data');
  const menu = await getDataProvider().getMenu();
  return fetchFoundationDocPageMarkdown(path, slug, id, menu);
}

export const getClientRuntimeConfig = (): ClientConfig => {
  const clientConfig = loadClientConfig();
  return clientConfig.config;
};

export const getTokens = (): CoreTypes.IDocumentationObject => {
  const exportedFilePath = process.env.HANDOFF_EXPORT_PATH
    ? path.resolve(process.env.HANDOFF_EXPORT_PATH, 'tokens.json')
    : path.resolve(process.cwd(), process.env.HANDOFF_OUTPUT_DIR ?? 'exported', 'tokens.json');

  if (!fs.existsSync(exportedFilePath)) {
    // Return proper default structure to prevent Next.js serialization errors
    // and ensure components can safely access design properties
    return {
      localStyles: {
        color: [],
        typography: [],
        effect: [],
      },
      components: {},
      assets: {},
    } as CoreTypes.IDocumentationObject;
  }

  const data = fs.readFileSync(exportedFilePath, 'utf-8');
  return JSON.parse(data.toString()) as CoreTypes.IDocumentationObject;
};

/** Prefer DB token snapshot, fallback to filesystem tokens.json. */
export const getTokensForRuntime = async (): Promise<CoreTypes.IDocumentationObject> => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(handoffTokensSnapshots)
      .orderBy(desc(handoffTokensSnapshots.id))
      .limit(1);
    const payload = rows[0]?.payload;
    if (payload && typeof payload === 'object') {
      return payload as CoreTypes.IDocumentationObject;
    }
  } catch {
    // ignore DB errors and fall back to filesystem tokens
  }
  return getTokens();
};

/**
 * Reduce a slug which can be either an array or string, to just a string by
 * plucking the first element
 * @param slug
 * @returns
 */
export const reduceSlugToString = (slug: string | string[] | undefined): string | undefined => {
  let prop: string | undefined;
  if (Array.isArray(slug)) {
    if (slug[0]) {
      prop = slug[0];
    }
  } else {
    prop = slug;
  }
  return prop;
};

/**
 * Get doc meta and content from markdown
 * @param path
 * @param slug
 * @returns
 */
export const fetchDocPageMetadataAndContent = (localPath: string, slug: string | string[] | undefined, runtimeConfig?: RuntimeConfig) => {
  const pagePath = localPath.replace('docs/', 'pages/');
  const handoffModulePath = process.env.HANDOFF_MODULE_PATH ?? '';
  const handoffWorkingPath = process.env.HANDOFF_WORKING_PATH ?? '';

  let currentContents = '';
  let options = {} as ComponentDocumentationOptions;

  const contentModuleFilePath = path.resolve(handoffModulePath, 'config', `${localPath}${slug}.md`);
  const contentWorkingFilePath = path.resolve(handoffWorkingPath, `${pagePath}${slug}.md`);

  if (fs.existsSync(contentWorkingFilePath)) {
    currentContents = fs.readFileSync(contentWorkingFilePath, 'utf-8');
  } else if (!fs.existsSync(contentModuleFilePath)) {
    return { metadata: {}, content: currentContents, options: {} };
  } else {
    currentContents = fs.readFileSync(contentModuleFilePath, 'utf-8');
  }

  const { data: metadata, content } = matter(currentContents);

  if (typeof slug === 'string' && runtimeConfig?.entries?.templates) {
    const viewConfigFilePath = path.resolve(runtimeConfig.entries.templates, slug, 'view.config.json');
    if (fs.existsSync(viewConfigFilePath)) {
      options = JSON.parse(fs.readFileSync(viewConfigFilePath, 'utf-8').toString()) as ComponentDocumentationOptions;
    }
  }

  return { metadata, content, options };
};

/**
 * Filter out undefined elements
 * @param value
 * @returns
 */
export const filterOutUndefined = <T>(value: T): value is NonNullable<T> => value !== undefined;

/**
 * Create a title string from a prefix
 * @param prefix
 * @returns
 */
export const titleString = (prefix: string | null): string => {
  const config = getClientRuntimeConfig();
  const prepend = prefix ? `${prefix} | ` : '';
  return `${prepend}${config?.app?.client} Design System`;
};

/**
 * Get the tokens for a component
 * @param component
 * @param type
 * @returns
 */
export const fetchTokensString = (component: string, type: 'css' | 'scss' | 'styleDictionary' | 'types'): string => {
  let tokens = '';
  const baseSearchPath = process.env.HANDOFF_EXPORT_PATH
    ? path.resolve(process.env.HANDOFF_EXPORT_PATH, 'tokens')
    : path.resolve(process.cwd(), process.env.HANDOFF_OUTPUT_DIR ?? 'exported', 'tokens');
  const scssSearchPath = path.resolve(baseSearchPath, 'sass', `${component}.scss`);
  const typeSearchPath = path.resolve(baseSearchPath, 'types', `${component}.scss`);
  const sdSearchPath = path.resolve(baseSearchPath, 'sd', 'tokens', `${component}.tokens.json`);
  const sdAltSearchPath = path.resolve(baseSearchPath, 'sd', 'tokens', component, `${component}.tokens.json`);
  const cssSearchPath = path.resolve(baseSearchPath, 'css', `${component}.css`);
  if (type === 'scss' && fs.existsSync(scssSearchPath)) {
    tokens = fs.readFileSync(scssSearchPath).toString();
  } else if (type === 'types' && fs.existsSync(typeSearchPath)) {
    tokens = fs.readFileSync(typeSearchPath).toString();
  } else if (type === 'styleDictionary') {
    if (fs.existsSync(sdSearchPath)) {
      // Foundations
      tokens = fs.readFileSync(sdSearchPath).toString();
    } else if (fs.existsSync(sdAltSearchPath)) {
      // Components
      tokens = fs.readFileSync(sdAltSearchPath).toString();
    }
  } else if (fs.existsSync(cssSearchPath)) {
    tokens = fs.readFileSync(cssSearchPath).toString();
  }
  return tokens;
};
