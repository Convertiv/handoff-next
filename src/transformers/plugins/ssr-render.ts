import esbuild from 'esbuild';
import fs from 'fs-extra';
import { Types as CoreTypes } from 'handoff-core';
import path from 'path';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Plugin, normalizePath } from 'vite';
import Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import {
    enrichPropertiesWithDocgen,
    generateDocsArtifact,
    generatePropertiesFromDocgen,
    getPropertiesFromGeneratedDocs,
} from '@handoff/transformers/docgen/index';
import { SlotMetadata } from '@handoff/transformers/preview/component';
import { MAIN_COMPONENT_CSS_FILE } from '@handoff/transformers/preview/component/css';
import { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { DEFAULT_CLIENT_BUILD_CONFIG, createReactResolvePlugin } from '@handoff/transformers/utils/build';
import { formatHtml, trimPreview } from '@handoff/transformers/utils/html';
import { buildAndEvaluateModule } from '@handoff/transformers/utils/module';
import { loadSchemaFromComponent, loadSchemaFromFile } from '@handoff/transformers/utils/schema-loader';
import { extractComponentName, generateUsageSnippet } from '@handoff/transformers/utils/usage';
import { createViteLogger } from '@handoff/transformers/utils/vite-logger';

/**
 * React component type for SSR rendering
 */
type ReactComponent = React.ComponentType<any>;

/**
 * Constants for the SSR render plugin
 */
const PLUGIN_CONSTANTS = {
  PLUGIN_NAME: 'vite-plugin-ssr-static-render',
  SCRIPT_ID: 'script',
  DUMMY_EXPORT: 'export default {}',
  ROOT_ELEMENT_ID: 'root',
  PROPS_SCRIPT_ID: '__APP_PROPS__',
  INSPECT_SUFFIX: '-inspect',
} as const;

/**
 * Loads and processes component schema using hierarchical approach
 * @param componentData - Component transformation data
 * @param componentPath - Path to the component file
 * @param handoff - Handoff instance
 * @returns Tuple of [properties, component] or [null, null] if failed
 */
async function loadComponentSchemaAndModule(
  componentData: TransformComponentTokensResult,
  componentPath: string,
  handoff: Handoff
): Promise<[{ [key: string]: SlotMetadata } | null, ReactComponent | null]> {
  let properties: { [key: string]: SlotMetadata } | null = null;
  let component: ReactComponent | null = null;

  // Step 1: Handle separate schema file (if exists)
  if (componentData.entries?.schema) {
    const schemaPath = path.resolve(componentData.entries.schema);
    properties = await loadSchemaFromFile(schemaPath, handoff);
  }

  // Step 2: Load component and handle component-embedded schema (only if no separate schema)
  if (!componentData.entries?.schema) {
    try {
      const moduleExports = await buildAndEvaluateModule(componentPath, handoff);
      component = moduleExports.exports.default;

      // Try to load schema from component exports
      properties = await loadSchemaFromComponent(moduleExports.exports, handoff);

      // If no schema found, use shared docgen fallback
      if (!properties) {
        properties = await generatePropertiesFromDocgen(componentPath, handoff);
      }
    } catch (error) {
      Logger.warn(`Failed to load component file "${componentPath}": ${error}`);
    }
  }

  // Step 3: Load component for rendering (if not already loaded)
  if (!component) {
    try {
      const moduleExports = await buildAndEvaluateModule(componentPath, handoff);
      component = moduleExports.exports.default;
    } catch (error) {
      Logger.error(`Failed to load component for rendering "${componentPath}":`, error);
      return [null, null];
    }
  }

  return [properties, component];
}

/**
 * Generates client-side hydration source code
 * @param componentPath - Path to the component file
 * @returns Client-side hydration source code
 */
function generateClientHydrationSource(componentPath: string): string {
  return `
    import React from 'react';
    import { hydrateRoot } from 'react-dom/client';
    import Component from '${normalizePath(componentPath)}';

    const raw = document.getElementById('${PLUGIN_CONSTANTS.PROPS_SCRIPT_ID}')?.textContent || '{}';
    const props = JSON.parse(raw);
    hydrateRoot(document.getElementById('${PLUGIN_CONSTANTS.ROOT_ELEMENT_ID}'), <Component {...props} />);
  `;
}

/**
 * Generates complete HTML document with SSR content and hydration.
 *
 * The client-side JS bundle is NOT inlined in the HTML — it is emitted as a
 * separate `${componentId}-client.mjs` artifact and referenced via an external
 * `<script type="module" src="...">` tag.  This keeps each HTML preview file
 * small (~1-2 KB) regardless of component-library size, which is critical for
 * React workspaces where the bundled JS can exceed 3 MB per component.
 *
 * The SSR-rendered HTML body is still present, so the preview renders visually
 * in the registry even if the `.mjs` artifact was too large to push and the
 * script tag 404s.
 *
 * @param componentId - Component identifier
 * @param previewTitle - Title for the preview
 * @param renderedHtml - Server-rendered HTML content
 * @param props - Component props as JSON
 * @param componentCssFilename - Actual CSS filename emitted by the Vite build.
 *   For React/Tailwind workspaces this is often project-named (e.g. `8x8-handoff.css`)
 *   rather than component-named (`button.css`).  Defaults to `${componentId}.css`
 *   for workspaces that generate a per-component CSS file via SCSS.
 * @returns Complete HTML document
 */
function generateHtmlDocument(
  componentId: string,
  previewTitle: string,
  renderedHtml: string,
  props: any,
  componentCssFilename = `${componentId}.css`,
): string {
  const base = process.env.HANDOFF_APP_BASE_PATH ?? '';
  // Component CSS uses a two-segment path so the registry resolves it by
  // (componentId, filename) rather than filename-only across all components.
  // This is required when the CSS is named after the project rather than the
  // component (e.g. `8x8-handoff.css` instead of `button.css`).
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="${base}/api/component/${MAIN_COMPONENT_CSS_FILE}" />
    <link rel="stylesheet" href="${base}/api/component/${componentId}/${componentCssFilename}" />
    <link rel="stylesheet" href="${base}/assets/css/preview.css" />
    <script id="${PLUGIN_CONSTANTS.PROPS_SCRIPT_ID}" type="application/json">${JSON.stringify(props)}</script>
    <script type="module" src="${base}/api/component/${componentId}/${componentId}-client.mjs"></script>
    <title>${previewTitle}</title>
  </head>
  <body>
    <div id="${PLUGIN_CONSTANTS.ROOT_ELEMENT_ID}">${renderedHtml}</div>
  </body>
</html>`;
}

/**
 * SSR render plugin factory
 * @param componentData - Component transformation data
 * @param documentationComponents - Documentation components
 * @param handoff - Handoff instance
 * @returns Vite plugin for SSR rendering
 */
export function ssrRenderPlugin(
  componentData: TransformComponentTokensResult,
  documentationComponents: CoreTypes.IDocumentationObject['components'],
  handoff: Handoff
): Plugin {
  return {
    name: PLUGIN_CONSTANTS.PLUGIN_NAME,
    apply: 'build',
    config: () => ({
      customLogger: createViteLogger(),
    }),
    resolveId(resolveId) {
      Logger.debug('resolveId', resolveId);
      if (resolveId === PLUGIN_CONSTANTS.SCRIPT_ID) {
        return resolveId;
      }
    },
    load(loadId) {
      if (loadId === PLUGIN_CONSTANTS.SCRIPT_ID) {
        return PLUGIN_CONSTANTS.DUMMY_EXPORT;
      }
    },
    async generateBundle(_, bundle) {
      // Remove all JS chunks to prevent conflicts
      for (const [fileName, chunkInfo] of Object.entries(bundle)) {
        const chunk = chunkInfo as { type?: string };
        if (chunk.type === 'chunk' && fileName.includes(PLUGIN_CONSTANTS.SCRIPT_ID)) {
          delete bundle[fileName];
        }
      }

      const componentId = componentData.id;
      // CSS filename placeholder — always use the default here.  The actual
      // CSS file may be named differently (e.g. `8x8-handoff.css`) when the
      // workspace's Vite config names the bundle after the project.  The
      // `writeBundle` hook below patches all HTML files on disk once Vite has
      // finished writing all assets (including the CSS produced by vite:css-post,
      // which runs its own generateBundle AFTER ours).
      const componentCssFilename = `${componentId}.css`;
      const componentPath = path.resolve(componentData.entries.template);
      const componentSourceCode = fs.readFileSync(componentPath, 'utf8');

      // Load component schema and module
      const [schemaProperties, ReactComponent] = await loadComponentSchemaAndModule(componentData, componentPath, handoff);
      const generatedDocs = await generateDocsArtifact(componentPath, handoff);

      if (!ReactComponent) {
        Logger.error(`Failed to load React component for ${componentId}`);
        return;
      }

      // Apply schema properties if found
      if (schemaProperties) {
        componentData.properties = schemaProperties;
      }

      if (generatedDocs) {
        const docgenProperties = getPropertiesFromGeneratedDocs(generatedDocs, componentPath, handoff);
        componentData.properties = enrichPropertiesWithDocgen(componentData.properties, docgenProperties) || {};
        componentData.docgen = generatedDocs;
      }

      // Ensure components object exists
      if (!documentationComponents) {
        documentationComponents = {};
      }

      // ── Build the client-side hydration bundle ONCE for all variants ──────────
      //
      // The hydration source is identical for every preview variant of a component
      // (same component file, same imports). Building it once saves significant
      // time on components with many variants (e.g. 50+ previews) and produces a
      // single `${componentId}-client.mjs` artifact that is shared by all HTML
      // preview files instead of being inlined in each one.
      //
      // This keeps individual HTML preview files at ~1-2 KB regardless of how
      // large the component library bundle is — critical for React workspaces
      // where the JS can exceed 3 MB.
      const clientHydrationSource = generateClientHydrationSource(componentPath);
      const clientBuildConfig = {
        ...DEFAULT_CLIENT_BUILD_CONFIG,
        logLevel: 'silent' as const,
        stdin: {
          contents: clientHydrationSource,
          resolveDir: process.cwd(),
          loader: 'tsx' as const,
        },
        plugins: [createReactResolvePlugin(handoff.workingPath, handoff.modulePath)],
      };

      // Apply user's client build config hook if provided
      const finalClientBuildConfig = handoff.config?.hooks?.clientBuildConfig
        ? handoff.config.hooks.clientBuildConfig(clientBuildConfig)
        : clientBuildConfig;

      let clientBundleJs: string | null = null;
      try {
        const bundledClient = await esbuild.build(finalClientBuildConfig);
        if (bundledClient.warnings.length > 0) {
          const messages = await esbuild.formatMessages(bundledClient.warnings, { kind: 'warning', color: true });
          messages.forEach((msg) => Logger.warn(msg));
        }
        clientBundleJs = bundledClient.outputFiles[0].text;
      } catch (error: any) {
        Logger.error(`Failed to build client bundle for ${componentId}`);
        if (error.errors) {
          const messages = await esbuild.formatMessages(error.errors, { kind: 'error', color: true });
          messages.forEach((msg) => Logger.error(msg));
        }
        // We continue without hydration — SSR HTML is still emitted for previews.
      }

      // Emit the shared client bundle as a named artifact.
      // The HTML files reference it as /api/component/${componentId}/${componentId}-client.mjs,
      // so the Playwright route interceptor resolves it to components/${id}/dist/${id}-client.mjs
      // during local screenshot generation. On the registry, the file is served from DB artifacts.
      if (clientBundleJs) {
        this.emitFile({
          type: 'asset',
          fileName: `${componentId}-client.mjs`,
          source: clientBundleJs,
        });
      }

      let finalHtml = '';

      // Generate previews for each variation
      for (const previewKey in componentData.previews) {
        const previewProps = componentData.previews[previewKey].values;

        // Server-side render the component
        const serverRenderedHtml = ReactDOMServer.renderToString(React.createElement(ReactComponent, previewProps));
        const formattedHtml = await formatHtml(serverRenderedHtml);

        // Generate complete HTML document (external JS reference — keeps file small)
        finalHtml = generateHtmlDocument(
          componentId,
          componentData.previews[previewKey].title,
          formattedHtml,
          previewProps,
          componentCssFilename,
        );

        // Emit preview files
        this.emitFile({
          type: 'asset',
          fileName: `${componentId}-${previewKey}.html`,
          source: finalHtml,
        });

        // TODO: remove this once we have a way to render inspect mode
        this.emitFile({
          type: 'asset',
          fileName: `${componentId}-${previewKey}${PLUGIN_CONSTANTS.INSPECT_SUFFIX}.html`,
          source: finalHtml,
        });

        componentData.previews[previewKey].url = `${componentId}-${previewKey}.html`;
        componentData.previews[previewKey].usage = generateUsageSnippet({
          componentName: extractComponentName(componentPath),
          properties: componentData.properties || {},
          previewValues: previewProps || {},
          templateFileName: path.basename(componentPath),
        });
      }

      // Format final HTML and update component data
      finalHtml = await formatHtml(finalHtml);
      componentData.format = 'react';
      componentData.preview = '';
      componentData.code = trimPreview(componentSourceCode);
      componentData.html = trimPreview(finalHtml);

      // Generate usage snippet from the first preview's values
      const previewKeys = Object.keys(componentData.previews);
      const firstPreviewValues = previewKeys.length > 0 ? componentData.previews[previewKeys[0]].values : {};
      const componentName = extractComponentName(componentPath);
      componentData.usage = generateUsageSnippet({
        componentName,
        properties: componentData.properties || {},
        previewValues: firstPreviewValues,
        templateFileName: path.basename(componentPath),
      });
    },

    // ── Patch HTML CSS references after all files are written ─────────────────
    //
    // `vite:css-post` (a built-in Vite plugin) adds the extracted CSS asset to
    // the bundle in its own `generateBundle` hook, which fires AFTER ours.  So
    // when we generate HTML we don't yet know the real CSS filename — we write a
    // placeholder (`${componentId}.css`).
    //
    // `writeBundle` is called after ALL plugins have run `generateBundle` and
    // Vite has written every file to disk.  At this point we can scan the output
    // directory, find the actual CSS file (e.g. `8x8-handoff.css`), and patch
    // all HTML preview files in-place.
    //
    // For workspaces that DO produce `${componentId}.css` (e.g. SSC with SCSS),
    // the placeholder already matches — no patching needed.
    async writeBundle(opts) {
      const outDir = opts.dir;
      if (!outDir) return;

      const componentId = componentData.id;
      const expectedCssName = `${componentId}.css`;
      const placeholder = `/api/component/${componentId}/${expectedCssName}`;

      // Find any CSS file in the output dir that isn't the placeholder name.
      let actualCssFile: string | null = null;
      try {
        const entries = await fs.readdir(outDir);
        const candidates = entries.filter(
          (n) => n.endsWith('.css') && n !== MAIN_COMPONENT_CSS_FILE && n !== 'shared.css' && n !== expectedCssName
        );
        if (candidates.length > 0) actualCssFile = candidates[0];
      } catch {
        return; // not fatal
      }

      if (!actualCssFile) return; // placeholder name matches reality — nothing to do

      const replacement = `/api/component/${componentId}/${actualCssFile}`;

      // Patch every HTML file that still contains the placeholder reference.
      try {
        const entries = await fs.readdir(outDir);
        const htmlFiles = entries.filter((n) => n.endsWith('.html'));
        for (const htmlFile of htmlFiles) {
          const htmlPath = path.join(outDir, htmlFile);
          try {
            const content = await fs.readFile(htmlPath, 'utf8');
            if (!content.includes(placeholder)) continue;
            await fs.writeFile(htmlPath, content.replace(placeholder, replacement), 'utf8');
          } catch {
            // skip unreadable/unwritable files
          }
        }
        Logger.debug(`CSS patch applied to ${htmlFiles.length} HTML preview(s): ${expectedCssName} → ${actualCssFile}`);
      } catch {
        // non-fatal — preview renders without CSS if patch fails
      }
    },
  };
}
