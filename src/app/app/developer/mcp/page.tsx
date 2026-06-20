import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

type Tool = {
  name: string;
  description: string;
  category: string;
  inputs?: { name: string; type: string; required?: boolean; description?: string }[];
};

const TOOLS: Tool[] = [
  // Context
  {
    name: 'handoff_get_project_context',
    description: 'Project hydration: stack profile, paths, Figma key, and translation hints. Call this first in any session to orient the model.',
    category: 'Context',
    inputs: [],
  },
  {
    name: 'handoff_get_stack_guide',
    description: 'Markdown authoring rules for the active stack (bootstrap-handlebars, react-tailwind, react-scss).',
    category: 'Context',
    inputs: [{ name: 'stackProfile', type: 'string', required: false, description: 'Override the detected stack profile' }],
  },
  {
    name: 'handoff_get_design_guidelines',
    description: 'Team Design.MD guidelines from design workspace settings.',
    category: 'Context',
    inputs: [],
  },
  {
    name: 'handoff_get_brand_voice',
    description: 'Formatted brand voice / copy guidelines from the design workspace.',
    category: 'Context',
    inputs: [],
  },
  // Components
  {
    name: 'handoff_search_components',
    description: 'Search component catalog by id, title, group, or tag substring.',
    category: 'Components',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'Substring to match against id, title, group, or tags' },
      { name: 'limit', type: 'number', required: false, description: 'Max results (default 20)' },
    ],
  },
  {
    name: 'handoff_get_component',
    description: 'Full component row by id — declaration metadata, variants, token usage.',
    category: 'Components',
    inputs: [{ name: 'id', type: 'string', required: true, description: 'Component identifier' }],
  },
  {
    name: 'handoff_get_component_reference',
    description: 'Component style reference image for a slot: buttons | inputs | iconography.',
    category: 'Components',
    inputs: [{ name: 'slot', type: 'enum', required: true, description: '"buttons" | "inputs" | "iconography"' }],
  },
  {
    name: 'handoff_get_reference',
    description: 'Fetch generated reference material: catalog | tokens | icons | property-patterns.',
    category: 'Components',
    inputs: [{ name: 'id', type: 'enum', required: true, description: '"catalog" | "tokens" | "icons" | "property-patterns"' }],
  },
  // Tokens
  {
    name: 'handoff_get_tokens',
    description: 'Design tokens snapshot for the deployment — colors, typography, spacing, effects.',
    category: 'Tokens',
    inputs: [],
  },
  // Icons & Logos
  {
    name: 'handoff_get_icon_catalog',
    description: 'Full icon catalog with ids, categories, tags, usage guidance, and source (SVG or iconify reference).',
    category: 'Icons & Logos',
    inputs: [{ name: 'category', type: 'string', required: false, description: 'Filter by category name' }],
  },
  {
    name: 'handoff_search_icons',
    description: 'Search icons by name, tag, or description substring.',
    category: 'Icons & Logos',
    inputs: [{ name: 'query', type: 'string', required: true, description: 'Substring to match against name, tags, or description' }],
  },
  {
    name: 'handoff_get_logo_set',
    description: 'Full logo set — all brand variants with SVG content, usage rules, and clearspace guidance.',
    category: 'Icons & Logos',
    inputs: [],
  },
  // Assets
  {
    name: 'handoff_search_assets',
    description: 'Search the asset library. Returns logos, icons, and images with URLs and metadata.',
    category: 'Assets',
    inputs: [
      { name: 'query', type: 'string', required: false, description: 'Search term' },
      { name: 'type', type: 'string', required: false, description: 'Filter by asset type' },
      { name: 'limit', type: 'number', required: false },
    ],
  },
  {
    name: 'handoff_get_asset',
    description: 'Full details for a single asset including component usages and size info.',
    category: 'Assets',
    inputs: [{ name: 'id', type: 'string', required: true }],
  },
  {
    name: 'handoff_list_asset_collections',
    description: 'List all asset collections (Figma sections or manually created groups).',
    category: 'Assets',
    inputs: [],
  },
  // Design artifacts
  {
    name: 'handoff_list_design_artifacts',
    description: 'List saved design library artifacts (screenshots, Figma exports).',
    category: 'Design Artifacts',
    inputs: [
      { name: 'status', type: 'string', required: false },
      { name: 'limit', type: 'number', required: false },
    ],
  },
  {
    name: 'handoff_get_design_artifact',
    description: 'Get a design artifact by id.',
    category: 'Design Artifacts',
    inputs: [{ name: 'id', type: 'string', required: true }],
  },
  {
    name: 'handoff_create_design_artifact',
    description: 'Create a design artifact with a base64-encoded image (requires design:write).',
    category: 'Design Artifacts',
    inputs: [
      { name: 'title', type: 'string', required: true },
      { name: 'imageBase64', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
    ],
  },
  {
    name: 'handoff_get_component_spec',
    description: 'Get the component specification (structured spec + editable markdown) for a saved design artifact.',
    category: 'Design Artifacts',
    inputs: [{ name: 'artifactId', type: 'string', required: true }],
  },
  {
    name: 'handoff_generate_component_from_design',
    description: "Fetch a design artifact's spec and extracted assets to generate a component locally. Queues spec generation if none exists yet.",
    category: 'Design Artifacts',
    inputs: [{ name: 'artifactId', type: 'string', required: true }],
  },
  // Sync
  {
    name: 'handoff_sync_status',
    description: 'Remote sync cursor and health. Returns workspace-mode notice if no registry is connected.',
    category: 'Sync',
    inputs: [],
  },
  {
    name: 'handoff_sync_pull',
    description: 'Fetch sync changes since cursor (JSON patches for local apply). Registry mode only.',
    category: 'Sync',
    inputs: [{ name: 'since', type: 'number', required: false, description: 'Cursor position (0 = all history)' }],
  },
  {
    name: 'handoff_list_reference_materials',
    description: 'List reference material ids and sizes.',
    category: 'Sync',
    inputs: [],
  },
];

const CATEGORIES = Array.from(new Set(TOOLS.map((t) => t.category)));

const SETUP_SNIPPET = `{
  "mcpServers": {
    "handoff": {
      "url": "https://YOUR-REGISTRY.vercel.app/api/mcp",
      "transport": "http"
    }
  }
}`;

export default function McpPage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">MCP Tools</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          Handoff exposes a Model Context Protocol server at <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono dark:bg-gray-800">/api/mcp</code>.
          Connect Cursor, Claude, or Windsurf to read design tokens, search components, look up icons, and generate components from design artifacts.
        </p>
      </div>

      {/* Setup */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Setup</h2>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Add the following to your editor's MCP config (<code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">.cursor/mcp.json</code> or <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">.claude/mcp.json</code>):
          </p>
          <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
            <code>{SETUP_SNIPPET}</code>
          </pre>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Both <strong>SSE</strong> (<code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">/api/mcp/sse</code>) and <strong>HTTP streaming</strong> transports are supported.
            Authentication uses the same Bearer token as push — obtained via <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">handoff-app login</code>.
          </p>
          <Link
            href="/dev/local-setup"
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' self-start font-normal'}
          >
            Local setup guide <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Tool reference */}
      {CATEGORIES.map((cat) => (
        <div key={cat}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{cat}</h2>
          <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {TOOLS.filter((t) => t.category === cat).map((tool) => (
              <div key={tool.name} className="px-5 py-4">
                <div className="flex flex-col gap-1.5">
                  <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{tool.name}</code>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{tool.description}</p>
                  {tool.inputs && tool.inputs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tool.inputs.map((inp) => (
                        <span
                          key={inp.name}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] dark:border-gray-700 dark:bg-gray-800"
                          title={inp.description}
                        >
                          <span className="font-mono text-gray-700 dark:text-gray-300">{inp.name}</span>
                          <span className="text-gray-400 dark:text-gray-500">:{inp.type}</span>
                          {!inp.required && <span className="text-gray-400 dark:text-gray-500">?</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
