import 'server-only';

import { createHandoffMcpServer } from '@/lib/mcp/create-server';
import type { McpAuthContext } from '@/lib/mcp-auth';

export type CatalogTool = { name: string; description: string; category: string };

/**
 * Category assignment for the public MCP tool reference. Keys are tool names;
 * anything not listed falls back to "Other" so a newly-registered tool always
 * shows up (just uncategorized) rather than silently disappearing.
 */
const CATEGORY_BY_TOOL: Record<string, string> = {
  // Context
  handoff_get_project_context: 'Context',
  handoff_get_stack_guide: 'Context',
  handoff_get_design_guidelines: 'Context',
  handoff_get_brand_voice: 'Context',
  // Components
  handoff_search_components: 'Components',
  handoff_get_component: 'Components',
  handoff_get_component_reference: 'Components',
  handoff_get_reference: 'Components',
  // Tokens
  handoff_get_tokens: 'Tokens',
  handoff_export_design_md: 'Tokens',
  // Icons & Logos
  handoff_get_icon_catalog: 'Icons & Logos',
  handoff_search_icons: 'Icons & Logos',
  handoff_get_logo_set: 'Icons & Logos',
  // Assets
  handoff_search_assets: 'Assets',
  handoff_get_asset: 'Assets',
  handoff_list_asset_collections: 'Assets',
  // Design artifacts
  handoff_list_design_artifacts: 'Design Artifacts',
  handoff_get_design_artifact: 'Design Artifacts',
  handoff_create_design_artifact: 'Design Artifacts',
  handoff_get_component_spec: 'Design Artifacts',
  handoff_generate_component_from_design: 'Design Artifacts',
  // Change inquiry
  handoff_recent_changes: 'Change Inquiry',
  handoff_component_history: 'Change Inquiry',
  handoff_change_why: 'Change Inquiry',
  // Pages & compositions
  handoff_list_pages: 'Pages & Compositions',
  handoff_get_page: 'Pages & Compositions',
  handoff_create_page: 'Pages & Compositions',
  handoff_update_page: 'Pages & Compositions',
  // Previews
  handoff_create_preview: 'Previews',
  handoff_update_preview: 'Previews',
  handoff_preview_component: 'Previews',
  // Documentation
  handoff_list_doc_pages: 'Documentation',
  handoff_get_doc_page: 'Documentation',
  handoff_create_doc_page: 'Documentation',
  handoff_update_doc_page: 'Documentation',
  // Build & Sync
  handoff_sync_status: 'Build & Sync',
  handoff_sync_pull: 'Build & Sync',
  handoff_sync_push: 'Build & Sync',
  handoff_enqueue_build: 'Build & Sync',
  handoff_list_reference_materials: 'Build & Sync',
};

/** Display order for categories; unknown categories sort to the end alphabetically. */
export const CATEGORY_ORDER = [
  'Context',
  'Components',
  'Tokens',
  'Icons & Logos',
  'Assets',
  'Design Artifacts',
  'Pages & Compositions',
  'Previews',
  'Documentation',
  'Change Inquiry',
  'Build & Sync',
  'Other',
];

const CATALOG_AUTH: McpAuthContext = {
  userId: 'catalog',
  role: 'admin',
  scopes: 'sync:read reference:read components:read design:read',
  isLegacySecret: false,
};

/**
 * Build the MCP tool catalog by instantiating the real server in-process and
 * reading its registered tools. Tools are all registered unconditionally
 * (scope checks happen inside each handler), so this reflects the full surface
 * without hitting the database — the single source of truth for the docs page.
 */
export function getMcpToolCatalog(): CatalogTool[] {
  const request = new Request('https://handoff.local/api/mcp');
  const server = createHandoffMcpServer(CATALOG_AUTH, request);
  const registered = (server as unknown as { _registeredTools?: Record<string, { description?: string }> })
    ._registeredTools;
  if (!registered) return [];

  const tools = Object.entries(registered).map(([name, def]) => ({
    name,
    description: def.description ?? '',
    category: CATEGORY_BY_TOOL[name] ?? 'Other',
  }));

  return tools.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    const ao = ai === -1 ? CATEGORY_ORDER.length : ai;
    const bo = bi === -1 ? CATEGORY_ORDER.length : bi;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}
