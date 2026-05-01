# Handoff - Design Token Automation

<a aria-label="NPM version" href="https://www.npmjs.com/package/handoff-app">
  <img alt="" src="https://img.shields.io/npm/v/handoff-app?style=for-the-badge&labelColor=000000">
</a>
<a aria-label="License" href="https://github.com/convertiv/handoff-app/blob/main/License.md">
  <img alt="" src="https://img.shields.io/npm/l/handoff-app?style=for-the-badge&labelColor=000000">
</a>

A design token pipeline that reads Figma files, extracts tokens as JSON, and
transforms them into developer-ready artifacts.

## Table of Contents

* [What Is Handoff?](#what-is-handoff)
* [How Does It Work?](#how-does-it-work)
* [Requirements](#requirements)
* [Quick Start (New Project)](#quick-start-new-project)
* [Core Workflows](#core-workflows)
  * [Fetch Design Tokens from Figma](#fetch-design-tokens-from-figma)
  * [Create a Component](#create-a-component)
  * [Add Documentation Pages](#add-documentation-pages)
* [Migrating an Existing Project](#migrating-an-existing-project)
* [Team / Cloud Setup (Postgres)](#team--cloud-setup-postgres)
* [Configuration Hooks](#configuration-hooks)
* [Further Reading](#further-reading)
* [Maintainers](#maintainers)
* [Contributing](#contributing)
* [License](#license)

## What Is Handoff?

Handoff is an open-source tool for extracting design tokens from the Figma REST
API and building frontend developer documentation from that Figma file. By
automating design token delivery, Handoff eliminates bottlenecks between design
and development.

Handoff is a collection of four tools:

* **Figma Token Extraction** - A framework for extracting standardized design
  foundations and components from Figma.
* **Transformation Pipeline** - Transformers that produce SASS, CSS, Style
  Dictionary, and preview snippets from extracted data.
* **Documentation Web App** - A Next.js server that renders live previews of
  your components, tokens, and styles. Uses embedded **SQLite** locally with
  zero config, or **Postgres** when `DATABASE_URL` is set for team features.
* **Delivery Tools** - Build tooling and CI/CD wrappers for automating token
  and documentation delivery.

## How Does It Work?

Handoff extracts design foundations and component data from
[well-formed Figma libraries](https://www.figma.com/file/IGYfyraLDa0BpVXkxHY2tE/Starter-%5BV2%5D?node-id=0%3A1\&t=iPYW37yDmNkJBt1t-0),
stores them as JSON, and transforms them into design tokens published as SASS
and CSS variables.

Out of the box, Handoff maps tokens to [Bootstrap 5](https://getbootstrap.com/).
For other frameworks or custom CSS, you can write map files to connect tokens
to your site or application.

* [Get Started](https://www.handoff.com/docs/quickstart)
* [Requirements](https://www.handoff.com/docs/overview/requirements)
* [Integrating Tokens](https://www.handoff.com/docs/tokens/integration)
* [Customization](https://www.handoff.com/docs/customization)

The pipeline from Figma to the documentation app can be automated via CI/CD for
automatic, up-to-date developer documentation.

* [CI/CD Integration](https://www.handoff.com/docs/guide/cicd)

## Requirements

* A paid Figma account (required to publish the Figma file library)
* Node 18.17+
* NPM 8+

No database setup is required for local development -- Handoff creates an
embedded SQLite database automatically on first start.

## Quick Start (New Project)

### 1. Set up Figma

1. Open the [Handoff Figma starter](https://www.figma.com/file/IGYfyraLDa0BpVXkxHY2tE/Starter-%5BV2%5D?node-id=0%3A1\&t=iPYW37yDmNkJBt1t-0)
   and duplicate the project to your account.

2. Publish components to the library:
   * Click the Figma logo (top left) > `Libraries` > current file > **Publish changes**

3. Create a personal access token:
   * Figma logo > `Help and Account` > `Account Settings` > `Personal Access Token`
   * Save the token for the next steps.

### 2. Scaffold the project

```bash
npx handoff-app init
```

The interactive CLI asks for:

1. **Project name** - directory name for your project
2. **Project type** - "with sample components" (recommended to start) or blank
3. **Figma credentials** - your Figma project ID and developer access token

This creates a project directory with `handoff.config.js`, `.env`,
`package.json`, and installs dependencies.

### 3. Fetch tokens and start

```bash
cd my-handoff-project
npm run fetch    # Extract tokens from your Figma file
npm run start    # Start the documentation server
```

Open http://localhost:3000. Handoff auto-creates a local SQLite database at
`.handoff/local.db` -- no setup needed.

### Verify the pipeline

1. In Figma, change a button color and re-publish the library.
2. Run `npm run fetch` again in your project.
3. The documentation site updates with the new tokens.

## Core Workflows

### Fetch Design Tokens from Figma

The CLI `fetch` command is the primary way to pull tokens from Figma:

```bash
handoff-app fetch
```

This extracts design foundations (colors, typography, spacing, effects) and
component data from your Figma file, writes the results to `exported/`, and
generates SASS/CSS variables.

**What you need:**

| Setting | Where to set it |
|---------|----------------|
| Figma project ID | `figma_project_id` in `handoff.config.js`, or `HANDOFF_FIGMA_PROJECT_ID` in `.env` |
| Developer access token | `dev_access_token` in `handoff.config.js`, or `HANDOFF_DEV_ACCESS_TOKEN` in `.env` |

If neither is set, the CLI prompts you interactively and saves the values to
`.env`.

**Output structure:**

```
exported/
  <project-id>/
    tokens.json          # All extracted token data
    tokens/
      _variables.scss    # SASS variables
      _variables.css     # CSS custom properties
      types.ts           # TypeScript token types
```

**Team / OAuth fetch:** With Postgres and Figma OAuth configured, admins can
also trigger token fetches from the app UI (see
[Team / Cloud Setup](#team--cloud-setup-postgres)).

### Server AI (OpenAI key or team cloud proxy)

The design workbench, pattern wizard, and related AI routes need **either**:

1. **`HANDOFF_AI_API_KEY`** on this machine (OpenAI calls run locally), or  
2. **`HANDOFF_CLOUD_URL` + `HANDOFF_CLOUD_TOKEN`** with **no** local
   `HANDOFF_AI_API_KEY` — Handoff forwards AI requests to your team server,
   which must have `HANDOFF_AI_API_KEY` and **`HANDOFF_SYNC_SECRET`** set to the
   same value as your local `HANDOFF_CLOUD_TOKEN`.

Asset extraction for saved designs uses the same proxy when configured: the
cloud runs OpenAI, and results are written back to your database on this
instance. Foundation previews and component screenshots stay local (no OpenAI).

### Create a Component

Handoff components live in directories listed in `entries.components` in your
`handoff.config.js`:

```javascript
module.exports = {
  entries: {
    components: ['./components'],
    // ...
  },
};
```

Each component is a directory containing a **declaration file**
(`<name>.handoff.js`) and template/style files.

#### Option A: Scaffold from Figma (recommended)

After fetching tokens, use the interactive scaffold to create stubs for Figma
components that don't have local implementations yet:

```bash
handoff-app scaffold
```

This command:
1. Reads your `tokens.json` to discover all Figma components
2. Compares them against locally registered components
3. Lets you select which components to scaffold
4. For each, prompts for title, group, template type (React TSX or Handlebars),
   and whether to include SCSS
5. Creates the files and optionally updates `handoff.config.js`

#### Option B: Quick create

Create a single component with a Handlebars template:

```bash
handoff-app make:component my-button
```

This creates:

```
components/
  my-button/
    my-button.hbs           # Handlebars template
    my-button.handoff.js    # Component declaration
    my-button.scss          # (optional) styles
    my-button.js            # (optional) client JS
```

#### Option C: Create via the app UI

When running the documentation server, admins can create components from the
System page. This stores the component in the database and triggers a build --
useful for team environments where components are managed centrally.

#### Component declaration format

A declaration file defines the component's metadata, template entry points, and
preview configurations:

```javascript
const { defineHandlebarsComponent } = require('handoff-app');

module.exports = defineHandlebarsComponent({
  id: 'my-button',
  name: 'My Button',
  description: 'Primary action button',
  group: 'Atomic Elements',
  type: 'element',
  entries: {
    template: './my-button.hbs',
    scss: './my-button.scss',
  },
  previews: {
    default: {
      title: 'Default',
      args: { label: 'Click me' }
    }
  }
});
```

For React components, use `defineReactComponent` with a `component` entry
instead of `template`.

### Add Documentation Pages

Documentation pages are Markdown files in the `pages/` directory:

```bash
handoff-app make:page getting-started
```

Pages support frontmatter for titles and menu ordering. The `pages/` directory
structure maps to URL paths -- `pages/tokens/colors.md` becomes
`/tokens/colors`.

Pages can also be created and edited in the database via the app UI, and
DB-stored pages take precedence over filesystem pages with the same slug.

## Migrating an Existing Project

If you have an existing Handoff project, migration is straightforward. Your
filesystem-based components, pages, and integration work are fully preserved.

### Step 1: Update Handoff

```bash
npm install handoff-app@latest
```

### Step 2: Clean up environment

Remove deprecated environment variables from your `.env`:

```bash
# Remove these lines (no longer used):
# HANDOFF_MODE=static
# HANDOFF_MODE=dynamic
# NEXT_PUBLIC_HANDOFF_MODE=...
```

No replacement is needed. Handoff now always runs as a full Next.js server.

### Step 3: Start the server

```bash
npm run start
```

On first start, Handoff automatically:
- Creates `.handoff/local.db` (embedded SQLite) -- no database setup required
- Discovers all components from your `entries.components` paths
- Loads pages from your `pages/` directory
- Serves your existing `exported/` tokens

### What gets discovered automatically

| Asset | Discovery mechanism |
|-------|-------------------|
| **Components** | Walks each path in `entries.components` from `handoff.config.js`, finds `*.handoff.{ts,js,cjs,json}` declaration files |
| **Pages** | Reads `.md` files from `pages/` directory, maps directory structure to URL paths |
| **Tokens** | Reads `exported/tokens.json` (or `HANDOFF_EXPORT_PATH`) from your last `handoff-app fetch` |
| **Integration** | SCSS/JS entry points from `entries.scss` and `entries.js` in config |
| **Patterns** | Reads pattern directories from `entries.patterns` in config |

### What's new for you

- **No static export**: The `out/` directory from `next export` is no longer
  generated. The app runs as a Node.js server (`handoff-app start` for dev,
  `next build && next start` for production).
- **Database-backed features**: Patterns, component edits, and pages can now be
  stored in the database alongside your filesystem sources. DB entries overlay
  filesystem entries when both exist for the same ID.
- **Team sync** (optional): Push your local declarations to a hosted Postgres
  instance with `handoff-app sync:push`, or pull team changes with
  `handoff-app sync:pull`. See [Team / Cloud Setup](#team--cloud-setup-postgres).

### Static export users

If you previously deployed the `out/` directory as a static site, switch to
running the Next.js server in production:

```bash
cd node_modules/handoff-app/src/app   # or your built app path
npx next build
npx next start -p 3000
```

Or sync your declarations to a team Postgres deployment and let it serve the
documentation site.

## Team / Cloud Setup (Postgres)

For team use with multi-user authentication, OAuth, AI features, and shared
design artifacts, configure a Postgres database:

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/handoff
AUTH_SECRET=generate-a-long-random-string
```

Then seed the admin user:

```bash
npm run db:seed
```

### Figma OAuth (GUI token fetch)

With Postgres, admins can connect a Figma account via OAuth and trigger
token fetches from the app UI instead of using CLI personal access tokens.

Required env vars:

```bash
AUTH_FIGMA_ID=your-figma-oauth-client-id
AUTH_FIGMA_SECRET=your-figma-oauth-client-secret
HANDOFF_FIGMA_PROJECT_ID=your-figma-project-id
```

### Cloud sync

Sync local project declarations to a hosted Handoff instance:

```bash
# .env (local project)
HANDOFF_CLOUD_URL=https://your-team-handoff.example.com
HANDOFF_CLOUD_TOKEN=shared-secret

# Push local components/pages/patterns to the team instance
handoff-app sync:push

# Pull team changes to your local project
handoff-app sync:pull
```

The remote instance must have `HANDOFF_SYNC_SECRET` set to the same value as
your local `HANDOFF_CLOUD_TOKEN`. That same pair enables **cloud AI proxy**
when you omit `HANDOFF_AI_API_KEY` locally (see [Server AI](#server-ai-openai-key-or-team-cloud-proxy)).

### Postgres-only features

These features require `DATABASE_URL` (Postgres):

- Multi-user authentication and role-based access
- User invitations and password reset emails
- Figma OAuth and GUI token fetch
- AI-powered design artifact extraction
- AI cost analytics
- Saved design artifacts
- Component generation from screenshots

## Configuration Hooks

Pipeline customization is done in `handoff.config.js` under `hooks` (camelCase
names: `validateComponent`, `jsBuildConfig`, `registerHandlebarsHelpers`, etc.).
For example, `registerHandlebarsHelpers` runs after Handoff registers the
built-in `field` and `eq` helpers so you can call `handlebars.registerHelper`
for your `.hbs` preview templates.

See [docs/api.md](docs/api.md#hooks) for hook arguments and examples.

## Further Reading

* [Configure your project](https://www.handoff.com/docs/customization)
* [Customize the content](https://www.handoff.com/docs/customization/content)
* [Integrate tokens with your project](https://www.handoff.com/docs/tokens/integration)
* [Integrate with Github Actions CI/CD](https://www.handoff.com/docs/infrastructure/github/)
* [Integrate with Bitbucket Pipelines CI/CD](https://www.handoff.com/docs/infrastructure/bitbucket/)

## Maintainers

[@bradmering](https://github.com/bradmering)

[@DomagojGojak](https://github.com/DomagojGojak).

[@Natko](https://github.com/Natko).

## Contributing

Feel free to dive in! [Open an issue](https://github.com/Convertiv/handoff-app/issues/new) or submit PRs.

Handoff follows the [Contributor Covenant](http://contributor-covenant.org/version/1/3/0/) Code of Conduct.

## License

[MIT](LICENSE) ©Convertiv
