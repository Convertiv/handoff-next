export default function PushPullPage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Push / Pull Guide</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          How workspace data flows to the registry and back. Understanding this model is the key to debugging sync issues.
        </p>
      </div>

      {/* Data flow diagram */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/30">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Data flow</h2>
        </div>
        <div className="p-6">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">{`Figma
  ↓  handoff-app fetch
Workspace: public/api/tokens/{color,typography,effect}.json
  ↓  scripts/tokens-to-dtcg.js   (Phase 0 — DTCG conversion)
Workspace: design-system/tokens/{primitive,semantic}/*.tokens.json
  ↓  scripts/tokens-transform.js  (Phase 1 — Style Dictionary)
Workspace: design-system/dist/{css,scss,tailwind,dtcg}/
  ↓  handoff-app push:all
Registry API  (HTTP POST to /api/registry/*)
  ↓  stored in Postgres
Registry pages  (read via DynamicDataProvider)`}</pre>
        </div>
      </div>

      {/* Two concepts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
          <h2 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">Workspace</h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            A client project repo (e.g. <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">ssc-handoff-next/handoff/</code>). Contains component source files, page markdown, <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff.config.js</code>, and the DTCG token pipeline. The workspace never deploys itself — it uses <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff-app</code> as a CLI tool.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
          <h2 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">Registry</h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            A clean, standalone deployment of the <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff-app</code> Next.js server (e.g. on Vercel). Contains no client-specific data at deploy time. All tenant data arrives via <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">push:all</code> and is stored in Postgres.
          </p>
        </div>
      </div>

      {/* push:all steps */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">push:all in detail</h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff-app push:all</code> calls these endpoints in sequence. Each uses a Bearer token
          obtained via <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff-app login</code>.
        </p>
        <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {[
            { step: '1', endpoint: 'POST /api/registry/config', what: 'Client identity, Figma project key, attribution settings', source: 'handoff.config.js app block' },
            { step: '2', endpoint: 'POST /api/registry/theme', what: 'Custom CSS overrides for the registry UI', source: 'theme.css' },
            { step: '3', endpoint: 'POST /api/registry/navigation', what: 'Page tree and sidebar structure', source: 'pages/ directory tree' },
            { step: '4', endpoint: 'POST /api/registry/pages', what: 'All markdown content with frontmatter', source: 'pages/**/*.md' },
            { step: '5', endpoint: 'POST /api/registry/tokens', what: 'Raw Figma token snapshot', source: 'public/api/tokens.json' },
            { step: '6', endpoint: 'POST /api/registry/dtcg', what: 'DTCG manifest and compiled CSS/SCSS/Tailwind/JSON', source: 'design-system/manifest.json + dist/' },
            { step: '7', endpoint: 'POST /api/registry/icons', what: 'Icon catalog — flat array of IconCatalogEntry objects', source: 'icons/catalog.json' },
            { step: '8', endpoint: 'POST /api/registry/logos', what: 'Logo set with variants and inline SVG content', source: 'logos/logo-set.json' },
          ].map(({ step, endpoint, what, source }) => (
            <div key={step} className="flex items-start gap-4 px-5 py-4">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {step}
              </span>
              <div className="flex flex-col gap-0.5">
                <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{endpoint}</code>
                <p className="text-sm text-gray-600 dark:text-gray-400">{what}</p>
                <p className="font-mono text-xs text-gray-400 dark:text-gray-500">← {source}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Component sync */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Component sync (push / pull)</h2>
        </div>
        <div className="p-6 flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong className="font-semibold text-gray-900 dark:text-gray-100">push</strong> sends individual component files via{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">POST /api/sync/upload</code>.
            Each upload includes declaration metadata, build artifacts (Vite dist), source files (.tsx, .css), and screenshots.
            Unchanged files are skipped based on a content hash.
          </p>
          <p>
            <strong className="font-semibold text-gray-900 dark:text-gray-100">pull</strong> calls{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">GET /api/sync/changes</code> and writes
            the changeset back to the workspace — updated pages, component declarations, build artifacts, and source files.
          </p>
        </div>
      </div>

      {/* Troubleshooting */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Common issues</h2>
        <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {[
            {
              problem: '500 on push (relation does not exist)',
              fix: 'The DB migration hasn\'t run yet. Trigger a new Vercel deploy or call /setup to force migration.',
            },
            {
              problem: 'Icons push skips with "must be a JSON array"',
              fix: 'icons/catalog.json must be a flat array of IconCatalogEntry objects — not wrapped in an object.',
            },
            {
              problem: '413 FUNCTION_PAYLOAD_TOO_LARGE',
              fix: 'DTCG payload is too large for one request. Check that design-system/dist/ isn\'t including source maps or vendor files.',
            },
            {
              problem: 'push:all succeeds but icons/logos still show "No data"',
              fix: 'Check Vercel function logs for auto-migrate errors. If migration 0012 isn\'t in the journal, it won\'t run.',
            },
          ].map(({ problem, fix }) => (
            <div key={problem} className="px-5 py-4">
              <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">{problem}</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{fix}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
