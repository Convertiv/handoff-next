# Handoff API

Handoff exposes a **JavaScript API** (the `Handoff` class in `handoff-app`) for interacting with the pipeline, and—when you run the documentation app in **dynamic mode**—an **HTTP API** for authenticated users to read and edit database-backed components and trigger preview builds.

The JavaScript API lets you integrate Handoff into Node applications, CI/CD, and command line tools, hook into pipeline execution, and generate build artifacts.

An **OpenAPI 3** description of the HTTP routes lives in [`api_spec.yaml`](api_spec.yaml) in this folder.

## Handoff App HTTP API (dynamic mode)

These routes are served by the Next.js app under your deployment origin. If `HANDOFF_APP_BASE_PATH` is set (for example `/docs`), prefix every path with that base. All routes below require `HANDOFF_MODE=dynamic` on the server; otherwise they respond with **404** and a JSON error.

Use `fetch(..., { credentials: 'include' })` so the NextAuth session cookie is sent.

### `GET /api/handoff/components?id={componentId}`

Returns the full `handoff_component` row (columns + `data` jsonb) for the given slug.

| | |
| --- | --- |
| **Auth** | Any signed-in user |
| **Query** | `id` (required) — component primary key |
| **200** | JSON row: `id`, `path`, `title`, `description`, `group`, `image`, `type`, `properties`, `previews`, `data`, timestamps |
| **400** | Missing `id` |
| **401** | Not authenticated |
| **404** | Component not found, or not in dynamic mode |

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
| **404** | Component not found, or not in dynamic mode |

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
| **404** | Job not found, or not in dynamic mode |

### `GET /api/components`

Returns the JSON array used by the system components list. In dynamic mode this is read from the database at request time; in static export mode it is generated at build time.

| | |
| --- | --- |
| **Auth** | None (public list) |

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

Hooks let you extend the build and preview pipeline. Configure them in
`handoff.config.js` (or `.cjs`) under the top-level `hooks` object. Hook names
use camelCase (for example `validateComponent`, `jsBuildConfig`,
`registerHandlebarsHelpers`). The Handoff CLI and Node API load this config when
the `Handoff` instance is created.

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
