# Handoff API

Handoff exposes a **JavaScript API** (the `Handoff` class in `handoff-app`) for interacting with the pipeline, and—when you run the full Next.js documentation app—an **HTTP API** for authenticated users to read and edit database-backed components and trigger preview builds. (Local dev without `DATABASE_URL` uses embedded SQLite and a synthetic admin session; set `DATABASE_URL` for Postgres + real NextAuth.)

The JavaScript API lets you integrate Handoff into Node applications, CI/CD, and command line tools, hook into pipeline execution, and generate build artifacts.

An **OpenAPI 3** description of the HTTP routes lives in [`api_spec.yaml`](api_spec.yaml) in this folder.

## Handoff App HTTP API

These routes are served by the Next.js app under your deployment origin. If `HANDOFF_APP_BASE_PATH` is set (for example `/docs`), prefix every path with that base. They require a valid session (cookie) unless noted; some admin-only routes return **403** without the right role.

Use `fetch(..., { credentials: 'include' })` so the NextAuth session cookie is sent.

**CLI sync to a remote Handoff (Postgres) instance:** set `HANDOFF_CLOUD_URL` to the remote app origin and `HANDOFF_CLOUD_TOKEN` to the same secret configured as `HANDOFF_SYNC_SECRET` on the server. Legacy names `HANDOFF_SYNC_URL` / `HANDOFF_SYNC_SECRET` still work. Then run `handoff sync:push` / `handoff sync:pull`.

### `GET /api/handoff/components?id={componentId}`

Returns the full `handoff_component` row (columns + `data` jsonb) for the given slug.

| | |
| --- | --- |
| **Auth** | Any signed-in user |
| **Query** | `id` (required) — component primary key |
| **200** | JSON row: `id`, `path`, `title`, `description`, `group`, `image`, `type`, `properties`, `previews`, `data`, timestamps |
| **400** | Missing `id` |
| **401** | Not authenticated |
| **404** | Component not found |

### `PATCH /api/handoff/components`

Partially updates a component: top-level fields and a merged `data` object (including `entrySources` for templates, styles, and scripts). See `ComponentPatchBody` in the codebase (`handoff-component-patch.ts`).

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Body** | JSON: must include `id` (component id). Optional: `title`, `description`, `group`, `type`, `image`, `path`, `categories`, `tags`, `should_do`, `should_not_do`, `data` |
| **200** | Updated row (same shape as GET) |
| **400** | Missing `id` |
| **401** | Not authenticated |
| **403** | Not admin |
| **404** | Component not found |

### `POST /api/handoff/components/build`

Enqueues an asynchronous Vite preview build for a component (worker writes sources, runs Handoff’s component pipeline, copies artifacts under `public/api/component/`).

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Body** | JSON: `{ "componentId": "<slug>" }` |
| **200** | `{ "jobId": <number>, "status": "queued" }` |
| **429** | Too many requests per user per minute, or build queue at capacity |
| **401** / **403** / **404** | Same semantics as PATCH |

### `GET /api/handoff/components/build?jobId={id}`

Polls a single build job created by `POST`.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Query** | `jobId` (required) — integer from POST response |
| **200** | `{ id, componentId, status, error, createdAt, completedAt }` — `status` is one of `queued`, `building`, `complete`, `failed` |
| **404** | Job not found |

### `GET /api/handoff/components/diff`

Compares on-disk component folders (from `handoff.config.js` → `entries.components`) with `handoff_component` rows.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **200** | `{ "diffs": [ { "id", "status", "fields" } ] }` — `status` is `new` \| `modified` \| `unchanged` \| `db_only`; each `fields` entry has `field`, `filesystem`, `database` snapshots |

### `POST /api/handoff/components/ingest`

Imports manifests + source files from disk into the database (upsert). If any selected component is **modified** vs the DB and you omit `decisions` / `overwriteAll`, the server responds **409** with a `conflicts` list.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Body** | Optional: `componentIds` (subset), `decisions` — map of component id → `filesystem` \| `keep_db` \| `skip`, `overwriteAll` (boolean), `dryRun` (boolean) |
| **200** | `{ "ingested", "skipped", "kept" }` |
| **409** | Conflicts — include `overwriteAll: true` or per-id `decisions` |
| **429** | Too many ingest requests per minute |

### `GET /api/handoff/components/entry-dirs`

Returns configured component roots from `handoff.config` `entries.components`, resolved against `HANDOFF_WORKING_PATH` when set, otherwise the handoff-app repo root. Used by the UI to pick an export destination.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **200** | `{ "projectRoot": string, "dirs": [{ "relative": string, "absolute": string }] }` |

### `POST /api/handoff/components/export`

Writes DB components to disk under `outputDir/<id>/` (legacy layout: `<id>.js`, `template.hbs`, `style.scss`, `script.js`). Default `outputDir` is `components`, resolved relative to **`HANDOFF_WORKING_PATH`** when set, otherwise the handoff-app repo root. Runs `git add` + `git commit` from that project root when `autoCommit` is not `false`.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Body** | Optional: `componentIds`, `outputDir` (must stay under the resolved project root), `autoCommit` |
| **200** | `{ "exported", "commitSha?", "gitMessage?", "gitWarning?" }` |
| **429** | Too many export requests per minute |

### `GET /api/components`

Returns the JSON array used by the system components list (resolved from the database / filesystem at request time).

| | |
| --- | --- |
| **Auth** | None (public list) |

### `POST /api/handoff/figma/fetch`

Queues a GUI-triggered Figma fetch job. The worker uses the current admin user's linked Figma OAuth account, runs the fetch pipeline, and writes refreshed token outputs to both filesystem artifacts and the DB snapshot table.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Body** | none |
| **200** | `{ "jobId": <number>, "status": "queued" }` |
| **400** | Figma not connected for this user |
| **429** | Too many requests, or fetch queue is full |

### `GET /api/handoff/figma/fetch`

Two modes:

- **No query params**: returns Figma OAuth connection status for current admin user.
- **With `jobId`**: polls one fetch job.

| | |
| --- | --- |
| **Auth** | **Admin** only |
| **Status mode** | `GET /api/handoff/figma/fetch` → `{ connected, oauthConfigured }` |
| **Job mode** | `GET /api/handoff/figma/fetch?jobId=<id>` → `{ id, status, error, createdAt, completedAt, triggeredByUserId }` |
| **Job statuses** | `queued`, `running`, `complete`, `failed` |

### `GET /api/handoff/patterns`

Lists patterns for the Playground / Patterns browser. In **static** mode, returns the same list as `patterns.json` (with synthetic `_source: "build"` metadata). In **dynamic** mode, reads from `handoff_pattern`.

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Query** | Optional: `q` (search title/description), `group`, `source` (`playground` / `build` / …) |
| **200** | `{ "patterns": [ PatternListObject & { _source, _thumbnail, … } ] }` |

### `GET /api/handoff/patterns/{id}`

Returns one pattern row for loading into the Playground (`components`, `data.previews`, etc.).

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **200** | `{ "pattern": { … } }` |

### `POST /api/handoff/patterns/{id}/clone`

Clones a DB pattern to a new id with `source: playground`.

| | |
| --- | --- |
| **Auth** | Signed-in user |

### `GET /api/handoff/ai/status`

Returns whether server-side Playground AI is configured (`HANDOFF_AI_API_KEY`) and the model id.

| | |
| --- | --- |
| **Auth** | None |
| **200** | `{ "available": boolean, "model": string }` |

### `POST /api/handoff/ai/generate-pattern`

Runs the Playground wizard prompt against OpenAI using the server key. Rate-limited per user.

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Body** | `{ "description": string, "content?": string, "currentPageSummary?": { id, title }[] }` |
| **200** | `{ "entries": BulkComponentEntry[], "warnings": string[] }` |
| **503** | No server AI: neither `HANDOFF_AI_API_KEY` nor cloud proxy (`HANDOFF_CLOUD_URL` + `HANDOFF_CLOUD_TOKEN` on the client, with matching `HANDOFF_SYNC_SECRET` + `HANDOFF_AI_API_KEY` on the upstream) |

### `POST /api/handoff/ai/generate-design`

Design workbench image edit (OpenAI `images/edits`). Requires `HANDOFF_AI_API_KEY` on this server, or is reached via **cloud AI proxy** (see [README](../README.md#server-ai-openai-key-or-team-cloud-proxy)). Rate-limited per user (or per `X-Handoff-Proxy-Acting-User` when called with sync bearer).

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Body** | `multipart/form-data`: `prompt` (required); `foundationContext` (JSON string: colors / typography / spacing / effects snapshot — server also rasterizes this into a PNG reference when non-empty); `componentGuides` (JSON string: selected component summaries); `conversationHistory` (JSON string: prior `{ role, prompt, imageUrl?, timestamp }[]`); `image[]` (zero or more PNG/JPEG/WEBP reference files, including per-prompt attachments and **PNG screenshots** from `GET /api/handoff/ai/component-screenshot` for each selected component preview); optional `iterationBase` (single file — usually the last 1024×1024 result for refinement) |
| **200** | `{ "image": string }` — data URL or hosted URL |
| **400** | Missing prompt, or no usable images after combining foundation raster, uploads, and iteration base |
| **503** | Server AI not configured |

### `GET /api/handoff/ai/component-screenshot`

Renders a built component preview HTML page in headless Chromium and returns a PNG (used by the Design workbench so GPT-image receives real pixels, not HTML). Requires Chromium installed locally (`npm run playwright:install`).

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Query** | `url` — URL-encoded app pathname to the preview HTML, e.g. `/api/component/accordion-demo.html` or `{HANDOFF_APP_BASE_PATH}/api/component/accordion-demo.html` when a base path is set |
| **200** | `image/png` |
| **400** | Missing or invalid `url` (must be under `/api/component/` and end in `.html`) |
| **502** | Screenshot failed (often missing browser binaries) |

### `POST /api/handoff/ai/design-artifact`

Persists a saved design from the workbench (`handoff_design_artifact`).

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Body** | JSON: `title`, `description`, `status` (`draft` \| `review` \| `approved`), `imageUrl`, optional `sourceImages`, `componentGuides`, `foundationContext`, `conversationHistory`, `metadata`; include `id` to update an artifact you own. Optional: `assets`, `assetsStatus`, `publicAccess` on update only when you need to override stored values. |
| **200** | `{ "id", "created": true }` or `{ "id", "updated": true }` — on **create**, if `HANDOFF_AI_API_KEY` is set, extraction is scheduled with Next.js `after()` (same Node process after the response) so `assets_status` moves from `pending` → `extracting` → `done` or `failed`. |

### `PATCH /api/handoff/ai/design-artifact`

Lightweight updates without a full POST body.

| | |
| --- | --- |
| **Auth** | Signed-in user (owner or **admin**) |
| **Body** | JSON: `id` (required). One of: `publicAccess` (boolean) to enable/disable the public share surface; `extractAssets: true` to reset `assets` and re-run extraction (`HANDOFF_AI_API_KEY` for async worker, or `HANDOFF_CLOUD_URL` + `HANDOFF_CLOUD_TOKEN` for synchronous proxy + write-back). |
| **200** | `{ "id", "publicAccess": … }`, `{ "id", "extractionQueued": true }`, or `{ "id", "extractionImmediate": true, "assets", "assetsStatus" }` when extraction completed via cloud proxy |
| **400** | Missing `id` or unsupported fields |
| **404** | Not found or not permitted |

### `POST /api/handoff/ai/design-artifact-extract`

Runs **synchronous** background/elements image extraction (same OpenAI `images/edits` pipeline as the design-asset worker) on a single composite `imageUrl` (data URL or `http(s)` image). Used internally when a local Handoff proxies asset extraction to a cloud that holds `HANDOFF_AI_API_KEY`.

| | |
| --- | --- |
| **Auth** | Signed-in user **or** `Authorization: Bearer` matching `HANDOFF_SYNC_SECRET` |
| **Body** | JSON: `imageUrl` (required) |
| **200** | `{ "assets": …[], "assetsStatus": "done" \| "failed", "extractionError": string \| null }` |
| **400** / **503** | Missing `imageUrl` / server AI not configured |

### `GET /api/handoff/ai/design-artifact/:id/public`

Read-only public view payload when the owner has enabled sharing.

| | |
| --- | --- |
| **Auth** | **None** (no session) |
| **200** | `{ "artifact": { id, title, description, status, imageUrl, assets, assetsStatus, createdAt, updatedAt } }` — sensitive fields (`userId`, `conversationHistory`, `sourceImages`, `foundationContext`, `metadata`) are **omitted** |
| **404** | Artifact not found or `public_access` is false |

### `GET /api/handoff/ai/design-artifact`

Lists saved design artifacts.

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Query** | Optional: `status`, `limit` (default 50, max 200). **Admin** may also pass `userId` to list another user’s artifacts. |
| **200** | `{ "artifacts": handoff_design_artifact[] }` — non-admin results are **scoped to the signed-in user**; `userId` is ignored for them. |

### `GET /api/handoff/ai/design-artifact/:id`

Returns one artifact if the signed-in user owns it, or if the user is an **admin**.

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **200** | `{ "artifact": handoff_design_artifact }` |
| **404** | Not found or not permitted |

### `POST /api/handoff/ai/generate-component`

Starts an **async design-to-component** job: LLM generates Handlebars/React/CSF sources, writes `handoff_component`, runs the Vite preview build worker, screenshots the `design` preview, and iterates with a vision model until visual score / accessibility checks pass (or max iterations). Work is scheduled with Next.js `after()`.

| | |
| --- | --- |
| **Auth** | Signed-in user (must own the artifact, or **admin**) |
| **Body** | JSON: `artifactId`, `componentName` (new slug), `renderer` (`handlebars` \| `react` \| `csf`), optional `behaviorPrompt`, `a11yStandard` (`none` \| `wcag-aa` \| `wcag-aaa`), `useExtractedAssets` (default true), `maxIterations` (1–5, default 3) |
| **200** | `{ "jobId": number }` |
| **400** / **403** / **404** / **409** | Validation, forbidden, artifact missing, or component id already exists |
| **503** | No server AI on this host (or unreachable via proxy from the caller) |

**Timeouts / dev:** cold Vite + Sass builds often exceed 90s. Set `HANDOFF_COMPONENT_BUILD_WAIT_MS` (poll window, default 300000) and `HANDOFF_COMPONENT_WORKER_TIMEOUT_MS` (per `handoff.component()` in the worker child, default 120000; passed via the worker env allowlist). Use `HANDOFF_APP_INTERNAL_ORIGIN` so Playwright can open preview URLs from background jobs.

### `GET /api/handoff/ai/generate-component`

Poll generation job status.

| | |
| --- | --- |
| **Auth** | Signed-in user |
| **Query** | `jobId` (number) **or** `artifactId` (returns latest job for that artifact) |
| **200** | `{ "job": component_generation_job \| null }` |

### `GET /api/handoff/admin/reference-materials`

Lists generated markdown blobs used as LLM context (`catalog`, `property-patterns`, `tokens`, `icons`).

| | |
| --- | --- |
| **Auth** | **Admin** |
| **Query** | Optional `id` — returns full row including `content` for one material |
| **200** | `{ "materials": [...] }` or `{ "material": row }` |

### `POST /api/handoff/admin/reference-materials`

Regenerates reference materials from the live component catalog and tokens (property-patterns may call the LLM unless `skipLlm: true`).

| | |
| --- | --- |
| **Auth** | **Admin** |
| **Body** | `{ "all": true }` or `{ "id": "catalog" \| "tokens" \| "icons" \| "property-patterns" }`, optional `skipLlm` |
| **200** | `{ "ok": true, ... }` |

### Security notes

- Build workers run in a separate Node process with an **allowlisted** subset of environment variables (see `docs/SECURITY-COMPONENT-BUILDS.md`).
- Treat **admin** as trusted for build execution; a future phase may use **containerized** builds for stronger isolation.

## Example Project

Here's a demo project you can check out to get started fast
https://github.com/Convertiv/handoff-0-6-0/

## Get Started

1. Run `npm install --save handoff-app`
2. Add handoff to your code. Create `handoff.ts`

```js
import Handoff from 'handoff-app';

const handoff = new Handoff({
  // You can customize the configuration here
});
handoff.fetch();
```

3. Build your typescript `tsc`
4. Run your project `node handoff.js`

## Methods

Methods of the handoff class can be called to run actions in the

### init

```js
handoff.init();
```

Init will check and build the local state, including the configuration. You
probably don't need to call this method since it is executed as part of the
class constructor

### fetch

```js
handoff.fetch();
```

Fetch will connect to the defined Figma file id provided in the
`env`. If no env or file is found, it will interactively request one. Then it
will export all of the tokens and generated data into an `exported` directory
in the local working root.

### build

```js
handoff.build();
```

Build will take the exported artifacts and build a react documentation site from
those artifacts. The build html site will be exported to the `out` directory
in the current working root

This method will throw an error if the `exported` directory or the `tokens.json`
files do not exist

### integration

```js
handoff.integration();
```

The integration method will run just the preview and integration generation.
This step is done as part of the build step, but its often useful to be able
to generate only the integration code.

## Hooks

Hooks let you extend the build and preview pipeline, and (for `middleware`) the
Next.js app that Handoff materializes under `<workingPath>/.handoff/app/`. Configure
them in `handoff.config.ts` / `.js` / `.mjs` (or `.cjs` for hooks that do not
need `middleware`) under the top-level `hooks` object. Hook names use camelCase
(for example `validateComponent`, `jsBuildConfig`, `registerHandlebarsHelpers`,
`middleware`). The Handoff CLI and Node API load this config when the `Handoff`
instance is created.

**`hooks.middleware`:** only supported when the main config file is **TypeScript
or ESM/CJS JavaScript** (`.ts`, `.mts`, `.js`, `.mjs`). It is **not** bundled from
`handoff.config.json` or `handoff.config.cjs` (use `.ts` / `.js` / `.mjs` if you
need this hook). After changing the hook, restart the Next dev server or re-run
app initialization so `middleware-hook.mjs` is regenerated.

```js
// handoff.config.js
module.exports = {
  // …
  hooks: {
    registerHandlebarsHelpers: ({ handlebars, componentId }) => {
      handlebars.registerHelper('upperId', () => componentId.toUpperCase());
    },
  },
};
```

### registerHandlebarsHelpers

Called immediately after Handoff registers built-in Handlebars helpers (`field`
and `eq`) while rendering **Handlebars** component previews (static HTML per
variation). Use it to call `handlebars.registerHelper` for custom helpers used
in your `.hbs` templates.

**Arguments (single context object)**

* `handlebars` — The Handlebars runtime (same as importing `handlebars`); use
  `registerHelper`, `SafeString`, etc.
* `componentId` — The current component’s id string.
* `properties` — The component’s slot metadata map from the schema (same shape
  as used by the `field` helper).
* `injectFieldWrappers` — `true` when generating inspect-mode previews (field
  inspection markup), `false` for normal previews.

**Return**

* `void` — register helpers on `handlebars` directly.

**Notes**

* This hook runs once per preview render (each variation × normal vs inspect).
* Registering the same helper name again replaces any previous registration for
  subsequent renders in the same process.

**Example**

```js
// handoff.config.js
module.exports = {
  hooks: {
    registerHandlebarsHelpers: ({ handlebars, componentId, injectFieldWrappers }) => {
      handlebars.registerHelper('debugPreview', function () {
        return injectFieldWrappers ? '[inspect]' : '[preview]';
      });
      handlebars.registerHelper('componentLabel', () => componentId);
    },
  },
};
```

### middleware

Runs in the Handoff Next.js [`middleware`](https://nextjs.org/docs/app/building-your-application/routing/middleware)
for every request matched by the built-in matcher (same scope as the default
admin JWT gate). Your hook receives the `NextRequest` and **`defaultProxy`**, a
function that runs Handoff’s default behavior (public paths, then optional
`/admin` JWT checks when `DATABASE_URL` is set).

**Arguments**

* `request` — `NextRequest` from `next/server`.
* `defaultProxy` — `async (request) => NextResponse` — call this to continue with
  the built-in logic, wrap its result, or skip it entirely (e.g. return `401`
  before calling it).

**Returns**

* `Promise<NextResponse>` — typically `return defaultProxy(request)` or a
  redirect / error response.

**Bundling**

At app init (`initializeProjectApp`), Handoff uses esbuild to emit
`middleware-hook.mjs` next to `middleware.ts`. Only `handoff-app` is marked
external; keep the hook Edge-safe if your deployment runs middleware on the
Edge runtime (avoid Node-only APIs unless you know your Next version runs this
middleware on Node).

**Example (HTTP Basic in front of Handoff defaults)**

```ts
// handoff.config.ts
import { defineConfig } from 'handoff-app';
import { NextResponse } from 'next/server';

const expected =
  'Basic ' + Buffer.from(`${process.env.HANDOFF_BASIC_USER ?? 'admin'}:${process.env.HANDOFF_BASIC_PASS ?? 'secret'}`).toString('base64');

export default defineConfig({
  hooks: {
    middleware: async (request, defaultProxy) => {
      const auth = request.headers.get('authorization');
      if (auth !== expected) {
        return new NextResponse('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Handoff"' },
        });
      }
      const res = await defaultProxy(request);
      res.headers.set('X-Handoff-Proxied-By', 'basic-auth');
      return res;
    },
  },
});
```

### postBuild

This function is called after the app build is complete.

**arguments**

* `tokens: DocumentationObject` This is an instance of the exported
  DocumentationObject containing all of the tokens.

**returns**
Nothing is returned from the postBuild hook

### postCssTransformer

This function is called after the css generation is complete. It allows an
application to alter the css generation in transit

**arguments**

* `tokens: DocumentationObject` This is an instance of the exported
  DocumentationObject containing all of the tokens.
* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as CSS variables

**returns**

* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as CSS variables.
  Any changes you return here will be written to the css files

### postCssTransformer

This function is called after the css generation is complete. It allows an
application to alter the css generation in transit. It will allow you to alter
the transformed output prior to being written to disk.

**arguments**

* `tokens: DocumentationObject` This is an instance of the exported
  DocumentationObject containing all of the tokens.
* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as CSS variables

**returns**

* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as CSS variables.
  Any changes you return here will be written to the css files.

### postScssTransformer

This function is called after the scss generation is complete. It allows an
application to alter the scss generation in transit. It will allow you to alter
the transformed output prior to being written to disk.

**arguments**

* `tokens: DocumentationObject` This is an instance of the exported
  DocumentationObject containing all of the tokens.
* `scss: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as SCSS variables

**returns**

* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as SCSS variables.
  Any changes you return here will be written to the scss files.

### postTypeTransformer

Handoff generates a set of scss files that list all the possible types of
a component (type, state, activity, size, theme, etc.). This allows frontend
engineers to iterate over the types and build scss maps with the variables.

This function is called after the type generation is complete. It allows an
application to alter the type generation in transit. It will allow you to alter
the transformed output prior to being written to disk.

**arguments**

* `tokens: DocumentationObject` This is an instance of the exported
  DocumentationObject containing all of the tokens.
* `scss: CssTransformerOutput` This is an object containing all of the
  type arrays for components and foundations, formatted as SCSS variables

**returns**

* `css: CssTransformerOutput` This is an object containing all of the
  tokens for components and foundations, formatted as type variables.
  Any changes you return here will be written to the scss type files.

### modifyWebpackConfig

When the application is built, Handoff uses webpack to compile css, scss,
and javascript in the entry point to build a little live preview of the
components. This hook accepts a webpack.Configuration as the first argument
and allows you to alter and return that configuration.

**arguments**

* `webpackConfig: webpack.Configuration` This is a full webpack configuration.

**returns**

* `webpackConfig: webpack.Configuration` Return the webpack configuration that
  you have altered to fit your needs.

**Example**

```js
export const modifyWebpackConfigForTailwind = (webpackConfig: webpack.Configuration): webpack.Configuration => {
  // Enable webpack dev mode
  webpackConfig.mode = 'development';
  return webpackConfig;
};
```

### configureExportables

This hook allows you to alter the exportable list. You could do this by ejecting
the handoff configuration and modifying the list, but this hook allows you to
alter the exportable list with just a couple of lines of code rather than
exporting the whole list

**arguments**

* `exportables: string[]` The current list of exportables

**returns**

* `exportables: string[]` Return the list with whatever additions and subtractions
  you need for your application.
