import { BuildOptions } from 'esbuild';
import type Handlebars from 'handlebars';
import { Types as HandoffTypes } from 'handoff-core';
import type { NextRequest, NextResponse } from 'next/server';
import type { InlineConfig } from 'vite';
import { SlotMetadata } from '@handoff/transformers/preview/slots';
import { ComponentListObject, PatternListObject, TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { ValidationResult } from './preview.js';

/** @see NextAppConfig.materialization_layout */
export type MaterializationLayout = 'legacy' | 'runtime' | 'root';

/** @see NextAppConfig.materialization_strategy */
export type MaterializationStrategy = 'full' | 'overlay';

export interface ImageStyle {
  name: string;
  style: string;
  height: number;
  width: number;
  description: string;
}

export interface TransformerConfig {
  /**
   * Reference to the transformer function from CoreTransformers
   * @example transformer: CoreTransformers.ScssTransformer
   */
  transformer: (options?: HandoffTypes.IHandoffTransformerOptions) => HandoffTypes.IHandoffTransformer;
  outDir: string;
  format: string;
}

export interface PipelineConfig {
  /**
   * List of transformers to be used in the build pipeline
   * Each transformer should specify the transformer function, output directory, and format
   * @example
   * ```typescript
   * transformers: [
   *   {
   *     transformer: Transformers.ScssTransformer,
   *     outDir: 'scss',
   *     format: 'scss'
   *   }
   * ]
   * ```
   */
  transformers?: TransformerConfig[];
}

export interface Breakpoints {
  mobile: { size: number; name: string };
  tablet: { size: number; name: string };
  desktop: { size: number; name: string };
}

/** Context passed to the `registerHandlebarsHelpers` config hook after built-in helpers (`field`, `eq`) are registered for a preview render. */
export type RegisterHandlebarsHelpersContext = {
  handlebars: typeof Handlebars;
  componentId: string;
  properties: { [key: string]: SlotMetadata };
  injectFieldWrappers: boolean;
};

export interface NextAppConfig {
  /**
   * @deprecated ADR-001 (registry as service): per-project materialization is
   * superseded by deploying convertiv/handoff-app directly as the registry.
   * Workspaces no longer materialize+deploy a Next.js app for themselves; they
   * push content to a hosted registry via `handoff-app push:all`. This option
   * only affects the legacy `prepare-runtime` / `vercel-build` pipeline, which
   * remains available for existing deployments but is slated for removal in a
   * future major release. See docs/REGISTRY-SETUP.md.
   *
   * Where the Next app is materialized relative to the Handoff working directory.
   * - `legacy` (default): `<workingPath>/.handoff/app`
   * - `runtime`: `<workingPath>/handoff-runtime` (stable sibling for host deploys)
   * - `root`: `<workingPath>` — use only when the repo root **is** the Next app (dedicated deploy repo)
   */
  materialization_layout?: MaterializationLayout;
  /** @deprecated alias for `materialization_layout` */
  materializationLayout?: MaterializationLayout;
  /**
   * @deprecated See `materialization_layout` deprecation note. Only applies to
   * the legacy materialized deploy pipeline.
   *
   * How Handoff updates the generated Next tree.
   * - `full` (default): always copy template from `handoff-app`
   * - `overlay`: skip full copy when `.handoff-app-bundle-version.json` matches (ignored when layout is `root`)
   */
  materialization_strategy?: MaterializationStrategy;
  /** @deprecated alias for `materialization_strategy` */
  materializationStrategy?: MaterializationStrategy;
  theme?: string;
  title: string;
  client: string;
  google_tag_manager?: string | null | undefined;
  googleTagManager?: string | null | undefined;
  type_copy?: string;
  typeCopy?: string;
  type_sort?: string[];
  typeSort?: string[];
  color_sort?: string[];
  colorSort?: string[];
  breakpoints: Breakpoints;
  component_sort?: string[];
  componentSort?: string[];
  base_path?: string;
  basePath?: string;
  attribution: boolean;
  ports?: {
    app: number;
    websocket: number;
  };
}

export type StackProfileId = 'bootstrap-handlebars' | 'react-tailwind' | 'react-scss';

/** Per-project MCP / agent hydration (optional; env vars used when omitted). */
export interface HandoffProjectProfileConfig {
  name?: string;
  stackProfile?: StackProfileId;
  figmaFileKey?: string | null;
  paths?: {
    components?: string[];
    patterns?: string[];
    pages?: string[];
  };
  translationRules?: string[];
}

export interface Config {
  projectProfile?: HandoffProjectProfileConfig;
  project_profile?: HandoffProjectProfileConfig;
  dev_access_token?: string | null | undefined;
  devAccessToken?: string | null | undefined;
  figma_project_id?: string | null | undefined;
  figmaProjectId?: string | null | undefined;
  exportsOutputDirectory?: string;
  sitesOutputDirectory?: string;
  useVariables?: boolean;
  /**
   * Configuration for React component docs generation (handoff-docgen).
   */
  reactDocgen?: {
    /**
     * Maximum recursion depth for nested type traversal.
     * @default 7
     */
    maxDepth?: number;
    /**
     * Directory names to exclude while scanning for components.
     * @default ["dist", "build", ".next"]
     */
    excludeDirectories?: string[];
  };
  app?: NextAppConfig;
  /**
   * Component validation framework (ADR-002). List of validators to run on
   * each component during build. Mix of built-in factories (axe, schema,
   * contrast) and inline custom validators.
   *
   * ```ts
   * import { axe, schema, contrast } from 'handoff-app/validators';
   * module.exports = {
   *   validation: {
   *     validators: [axe({ spec: 'wcag21aa' }), schema(), contrast()],
   *     failOn: 'error',
   *   },
   * };
   * ```
   *
   * Supersedes the single-slot `hooks.validateComponent` (which still works
   * for back-compat but is deprecated).
   */
  validation?: import('./validation.js').ValidationConfig;
  /**
   * Configuration for the build pipeline
   */
  pipeline?: PipelineConfig;
  /**
   * Configuration for entry points to assets and components that will be built
   */
  entries?: {
    /**
     * Path to the main SCSS entry file
     * @example "styles/main.scss"
     */
    scss?: string;
    /**
     * Path to the main JavaScript entry file
     * @example "scripts/main.js"
     */
    js?: string;
    /**
     * Array of component paths to be included in the build
     * @example ["components/button", "components/input"]
     */
    components?: string[];
    /**
     * Array of pattern paths to be included in the build.
     * Patterns compose multiple component previews into single-page views.
     * @example ["patterns/hero-section", "patterns"]
     */
    patterns?: string[];
  };
  /**
   * Configuration for asset zip file download links
   * @default { icons: "/icons.zip", logos: "/logos.zip" }
   */
  assets_zip_links?: {
    /**
     * Path to the icons zip file
     * @default "/icons.zip"
     */
    icons?: string;
    /**
     * Path to the logos zip file
     * @default "/logos.zip"
     */
    logos?: string;
  };
  assetsZipLinks?: {
    icons?: string;
    logos?: string;
  };
  /**
   * Configuration hooks for extending functionality
   */
  hooks?: {
    /**
     * @deprecated Use the new validation framework (ADR-002) — declare
     * validators in `config.validation.validators[]` instead. Custom
     * validators implement the {@link Validator} interface and can return
     * structured findings with severity, target selectors, and help URLs.
     * This single-slot hook continues to work for back-compat and is
     * automatically adapted into a custom validator under the hood, but new
     * projects should use `config.validation`.
     *
     * Optional validation callback for components
     * @param component - The component instance to validate
     * @returns A record of validation results where keys are validation types and values are detailed validation results
     */
    validateComponent?: (component: TransformComponentTokensResult) => Promise<Record<string, ValidationResult>>;

    /**
     * Optional hook to override the SSR build configuration used in the ssrRenderPlugin
     * @param config - The default esbuild configuration
     * @returns Modified esbuild configuration
     * @example
     * ```typescript
     * ssrBuildConfig: (config) => {
     *   ... // Modify the esbuild config as needed
     *   return config;
     * }
     * ```
     */
    ssrBuildConfig?: (config: BuildOptions) => BuildOptions;

    /**
     * Optional hook to override the client-side build configuration used in the ssrRenderPlugin
     * @param config - The default esbuild configuration
     * @returns Modified esbuild configuration
     * @example
     * ```typescript
     * clientBuildConfig: (config) => {
     *   ... // Modify the esbuild config as needed
     *   return config;
     * }
     * ```
     */
    clientBuildConfig?: (config: BuildOptions) => BuildOptions;

    /**
     * Optional hook to specify which export property contains the schema
     * @param exports - The module exports object containing the schema
     * @returns The schema object from the exports
     * @example
     * ```typescript
     * getSchemaFromExports: (exports) => exports.customSchema || exports.default
     * ```
     */
    getSchemaFromExports?: (exports: any) => any;

    /**
     * Optional hook to transform the schema into properties
     * @param schema - The schema object to transform
     * @returns The transformed properties object
     */
    schemaToProperties?: (schema: any) => { [key: string]: SlotMetadata };

    /**
     * Optional hook to override the JavaScript Vite configuration
     * @param config - The default Vite configuration
     * @returns Modified Vite configuration
     * @example
     * ```typescript
     * jsBuildConfig: (config) => {
     *   ... // Modify the Vite config as needed
     *   return config;
     * }
     * ```
     */
    jsBuildConfig?: (config: InlineConfig) => InlineConfig;

    /**
     * Optional hook to override the CSS Vite configuration
     * @param config - The default Vite configuration
     * @returns Modified Vite configuration
     * @example
     * ```typescript
     * cssBuildConfig: (config) => {
     *   ... // Modify the Vite config as needed
     *   return config;
     * }
     * ```
     */
    cssBuildConfig?: (config: InlineConfig) => InlineConfig;

    /**
     * Optional hook to override the HTML Vite configuration
     * @param config - The default Vite configuration
     * @returns Modified Vite configuration
     * @example
     * ```typescript
     * htmlBuildConfig: (config) => {
     *   ... // Modify the Vite config as needed
     *   return config;
     * }
     * ```
     */
    htmlBuildConfig?: (config: InlineConfig) => InlineConfig;

    /**
     * Optional hook invoked after Handoff registers built-in Handlebars helpers for
     * component preview HTML. Use `context.handlebars.registerHelper` to add or
     * replace helpers. Called once per preview render (per variation and inspect mode).
     *
     * @param context - Handlebars runtime, component id/properties, and whether
     *   inspect field wrappers are enabled for this render.
     * @example
     * ```typescript
     * registerHandlebarsHelpers: ({ handlebars, componentId }) => {
     *   handlebars.registerHelper('upperId', () => componentId.toUpperCase());
     * }
     * ```
     */
    registerHandlebarsHelpers?: (context: RegisterHandlebarsHelpersContext) => void;

    /**
     * Wrap or replace the default Handoff Next.js middleware (admin JWT gate and public paths).
     * Receives the incoming request and `defaultProxy`, which runs the built-in logic.
     * Return a `NextResponse` from `defaultProxy`, a redirect, or a custom response (e.g. 401 basic auth).
     *
     * Implemented via a bundled `middleware-hook.mjs` in the project app directory at init time;
     * change your hook and restart dev / re-run `handoff-app start` to pick up updates.
     *
     * @example
     * ```ts
     * middleware: async (request, defaultProxy) => {
     *   const res = await defaultProxy(request);
     *   res.headers.set('X-Example', '1');
     *   return res;
     * }
     * ```
     */
    middleware?: (
      request: NextRequest,
      defaultProxy: (request: NextRequest) => Promise<NextResponse>
    ) => Promise<NextResponse>;
  };
}

export type ClientConfig = Pick<Config, 'app' | 'exportsOutputDirectory' | 'sitesOutputDirectory' | 'assets_zip_links' | 'useVariables'>;

export interface RuntimeConfigComponentOptions {
  cssRootClass?: string;
  tokenNameSegments?: string[];
  defaults: {
    [variantProperty: string]: string;
  };
  replace: { [variantProperty: string]: { [source: string]: string } };
}

export interface ConfigFileEntry {
  kind: string;
  entityId: string;
}

export interface RuntimeConfig {
  entries?: {
    scss?: string;
    js?: string;
    templates?: string;
    components: {
      [id: string]: ComponentListObject;
    };
    patterns: {
      [id: string]: PatternListObject;
    };
  };
  options: {
    [key: string]: RuntimeConfigComponentOptions;
  };
}

declare const config: Config;

export default config;
