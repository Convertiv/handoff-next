# Handoff CLI

The Handoff cli allows you to interact with your Figma file and Handoff app
via the command line. It allows you to run handoff in any folder with
no other configuration or setup.  

## Interacting with Figma
The CLI will allow you to fetch all data from Figma, build the documentation
app and run a local dev site. For these use the build, fetch, and serve commands
documented below.  

## Configuring a handoff project
The CLI will allow you to build the various kinds of configurations that you
will need for interacting with Figma. Handoff has sane configuration defaults
but the various kinds of configurations can be tailored or extended.

Handoff has 4 configuration areas - 

`handoff.config.*` - Defines the general handoff configuration. Supported files are `handoff.config.ts`, `handoff.config.js`, `handoff.config.cjs`, and `handoff.config.json` (resolved in that precedence order).
`pages` - Markdown files that will create or customize pages in the documentation
app
`exportables` - JSON schemas for each component in your figma file that you
want to pull into handoff.
`integration` - scss mappings and html templates for making it easy to map
handoff tokens to your frontend framework.

The CLI exposes two ways to manage the config - `make` and `eject`. 

__Eject__ commands will take the default configuration and eject them into
the current working directory. If you customize these configurations, then run 
handoff commands in that directory, these configs will be executed. `eject:config` now prompts for TypeScript or JavaScript config format.
__Make__ commands will generate a boilerplate configuration in the current
working directory. This is useful for extending handoff for different components
or integrations.

## Requirements
Node 16+

## Install the CLI 

`npm install -g handoff-app`

## Run the CLI

`handoff-app --help`

## Commands and Flags

Usage: handoff-app <cmd> <opts>

Commands:
  fetch [opts] - Fetches the design tokens from the design system

  audit:figma-components [opts] - Compares fetched/published Figma components against locally registered Handoff components. Reports Figma-only components, missing/broken `figmaComponentId` links, and structured Figma metadata gaps. Use `--json` for machine-readable output and `--fail-on-drift` to exit non-zero when drift is detected.

  login [opts] - Signs in to a hosted Handoff deployment using the OAuth 2.0 device authorization grant (RFC 8628). Run this once per machine (or per project) so `pull` / `push` / `sync-status` can use a stored access token instead of pasting the server sync secret. By default the CLI tries to open the verification URL in your system browser (`--no-browser` to skip; also skipped when `CI=1` or `HANDOFF_LOGIN_NO_BROWSER=1`). Optional: `--url <origin>` if the CLI cannot infer the deployment (defaults follow `HANDOFF_CLOUD_URL` / `HANDOFF_SYNC_URL` resolution). Tokens are written to `.handoff/cli-auth.json` (ignored when `.handoff` is gitignored).

  logout [opts] - Removes stored CLI credentials for the resolved deployment (same URL resolution as other sync commands).

  pull [opts] - Pulls remote edits from a Handoff deployment running in dynamic mode into local `pages/` and `*.handoff.json` files. Prefer `handoff-app login` so the CLI sends a deployment-scoped bearer token. Legacy: set `HANDOFF_CLOUD_URL` + `HANDOFF_CLOUD_TOKEN` (or `HANDOFF_SYNC_URL` / `HANDOFF_SYNC_SECRET`) to match the server’s `HANDOFF_SYNC_SECRET` (automation / CI). Use `--dry-run` to fetch the remote changeset and print what would happen without writing files or updating `.handoff/sync-state.json`.

  push [opts] - Pushes local markdown pages and `*.handoff.json` component/pattern declarations to the remote API (same auth resolution as `pull`). Optional: `--components <id>…`, `--patterns <id>…`, `--pages <slug>…` to push a subset only (when any of these are set, categories you omit are not pushed). Use `--dry-run` to list what would be uploaded (no network; no cloud env vars required).

  sync-status [opts] - Prints the remote sync cursor and local `.handoff/sync-state.json` metadata (same URL and bearer resolution as `push` / `pull`).

  build - Using the current tokens, build various outputs
    build:app [opts] - Builds the design system static application
  prepare-runtime [opts] - Writes the Next.js Handoff app to `.handoff/runtime` for CI/Vercel (no `next build`)

  start [opts] - Starts the design system in development mode

  make
    make:template <component> <state> [opts] - Creates a new template
    make:page <component> <state> [opts] - Creates a new page

  eject - Ejects the default entire configuration to the current directory
    eject:config [opts] - Ejects the default configuration to the current directory
    eject:integration [opts] - Ejects the default integration to the current directory
    eject:pages [opts] - Ejects the default pages to the current directory

Options:
  -c, --config [file]      Define the path to the config file
  -d, --debug              Show debug logs
  -h, --help               Show this help message
  -v, --version            Show the handoff version number
