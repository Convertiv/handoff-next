import 'server-only';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { buildProjectContext, resolveStackProfile } from '@/lib/mcp/project-profile';
import { buildDesignMd } from '@/lib/mcp/design-md';
import { loadStackGuideMarkdown } from '@/lib/mcp/stack-guides';
import { getReferenceMaterialById, listReferenceMaterials } from '@/lib/db/queries';
import { isReferenceMaterialId, REFERENCE_MATERIAL_IDS } from '@/lib/server/reference-material-ids';
import { getDataProvider } from '@/lib/data';
import type { DtcgTokenType, DtcgTokenStrings } from '@/lib/data/types';
import { usePostgres } from '@/lib/db/dialect';
import { fetchSyncChangesSince } from '@/lib/db/sync-queries';
import { applyUploadedChange } from '@/lib/db/sync-queries';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { jwtScopesInclude } from '@/lib/cli-sync-jwt';
import {
  formatBrandVoiceForPrompt,
  formatDesignWorkspaceForMcp,
  getDesignWorkspace,
} from '@/lib/server/design-workspace';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';
import {
  getAsset,
  getAssetWithUsages,
  listAssetCollections,
  listAssets,
  listIconSets,
} from '@/lib/db/queries';

const WORKSPACE_MODE_RESPONSE = {
  mode: 'workspace',
  message: 'Registry features unavailable in workspace mode. Set DATABASE_URL and HANDOFF_CLOUD_URL to connect a registry.',
} as const;

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

function requireScope(auth: McpAuthContext, scope: string) {
  if (auth.isLegacySecret) return null;
  if (!jwtScopesInclude(auth.scopes, scope)) {
    return textResult({ error: `Forbidden — missing scope: ${scope}` });
  }
  return null;
}

// ── Token slimming for MCP ──────────────────────────────────────────────────
// The raw token snapshot (IDocumentationObject) carries ~22K tokens of payload:
// full icon/logo SVG source, per-component token usage, and a duplicate SCSS
// `$map`. None of that is useful as *foundation token context* for a model, and
// it overflows context windows. Strip to the foundation styles (colors,
// typography, effects, plus any future areas like spacing/radius/grid) and drop
// per-entry Figma noise. Icons/logos/components have dedicated tools. ~77% smaller.

type AnyRecord = Record<string, unknown>;

function slimColor(c: AnyRecord) {
  return {
    name: c.name,
    value: c.value,
    group: c.group,
    sass: c.sass,
    reference: c.reference,
    machineName: c.machineName,
  };
}

function slimTypography(t: AnyRecord) {
  const v = (t.values ?? {}) as AnyRecord;
  return {
    name: t.name,
    reference: t.reference,
    machineName: t.machine_name ?? t.machineName,
    values: {
      fontFamily: v.fontFamily,
      fontSize: v.fontSize,
      fontWeight: v.fontWeight,
      fontStyle: v.fontStyle,
      lineHeightPx: v.lineHeightPx,
      letterSpacing: v.letterSpacing,
    },
  };
}

function slimEffect(e: AnyRecord) {
  return { name: e.name, effects: e.effects, reference: e.reference, machineName: e.machineName };
}

function slimTokensForMcp(doc: unknown, include: string[] = []): AnyRecord {
  const d = (doc ?? {}) as AnyRecord;
  const ls = (d.localStyles ?? {}) as AnyRecord;
  const out: AnyRecord = { timestamp: d.timestamp };

  if (Array.isArray(ls.color)) out.colors = (ls.color as AnyRecord[]).map(slimColor);
  if (Array.isArray(ls.typography)) out.typography = (ls.typography as AnyRecord[]).map(slimTypography);
  if (Array.isArray(ls.effect)) out.effects = (ls.effect as AnyRecord[]).map(slimEffect);
  // Forward any other foundation arrays untouched (future: spacing, radius, grid).
  for (const [k, v] of Object.entries(ls)) {
    if (['color', 'typography', 'effect', '$map'].includes(k)) continue;
    out[k] = v;
  }

  out._note =
    'Foundation tokens. colors/typography/effects: use `sass` or `reference` to reference in code, `value` for the resolved value. ' +
    'spacing/borderRadius/grid (when present) come from DTCG: use `cssVariable` (e.g. var(--spacing-2)), `value` for resolved. ' +
    'Icons → handoff_get_icon_catalog / handoff_search_icons. Logos → handoff_get_logo_set. ' +
    'Per-component token usage → handoff_get_component. ' +
    'Pass include:["assets","components","map"] to opt back into the heavy raw sections.';

  if (include.includes('assets')) out.assets = d.assets;
  if (include.includes('components')) out.components = d.components;
  if (include.includes('map')) out.$map = ls.$map;
  return out;
}

// ── DTCG dimension tokens (spacing / border-radius / grid) ──────────────────
// These live in the DTCG pipeline (getDtcgTokenStrings), a separate path from the
// Figma localStyles snapshot that get_tokens reads — so they were invisible to MCP
// consumers. Flatten the resolved DTCG for each dimension type into a compact list
// with the deployed CSS-variable name, resolved value, and description.

function flattenDtcgLeaves(node: unknown, path: string[], out: AnyRecord[]): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as AnyRecord;
  if ('$value' in obj) {
    out.push({
      name: path.join('.'),
      value: obj.$value,
      cssVariable: `--${path.join('-')}`,
      description: obj.$description,
    });
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue;
    flattenDtcgLeaves(v, [...path, k], out);
  }
}

async function dtcgDimensionTokens(
  provider: { getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null> },
  type: DtcgTokenType
): Promise<AnyRecord[]> {
  let strings: DtcgTokenStrings | null = null;
  try {
    strings = await provider.getDtcgTokenStrings(type);
  } catch {
    return [];
  }
  if (!strings?.dtcg) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(strings.dtcg);
  } catch {
    return [];
  }
  const out: AnyRecord[] = [];
  flattenDtcgLeaves(parsed, [], out);
  return out;
}

/** Slim Figma-snapshot tokens + merged DTCG dimension tokens (spacing/radius/grid). */
async function collectFoundationTokens(
  provider: {
    getTokens(): Promise<unknown>;
    getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null>;
  },
  include: string[] = []
): Promise<AnyRecord> {
  const tokens = await provider.getTokens();
  const out = slimTokensForMcp(tokens, include);
  const [spacing, borderRadius, grid] = await Promise.all([
    dtcgDimensionTokens(provider, 'spacing'),
    dtcgDimensionTokens(provider, 'border-radius'),
    dtcgDimensionTokens(provider, 'grid'),
  ]);
  if (spacing.length) out.spacing = spacing;
  if (borderRadius.length) out.borderRadius = borderRadius;
  if (grid.length) out.grid = grid;
  return out;
}

// ── Component slimming for MCP ──────────────────────────────────────────────
// handoff_get_component returns the full component row — ~143K tokens, of which
// ~97% is a single `sharedStyles` field (the entire compiled DS CSS, repeated on
// every call). The implementation data a code-gen consumer needs (code, html,
// sass, css, properties, identity, guidance) is ~630 tokens. Strip the heavy /
// internal fields; ~99% smaller. `include` re-adds fields by name, 'figma' for
// all Figma sync metadata, or 'all' for the raw row.

const COMPONENT_HEAVY_FIELDS = new Set([
  'sharedStyles', // ~139K tokens — the entire compiled design-system CSS
  'validationResults', // build/lint output noise
  'handoffConfig', // internal config dump
]);

function slimComponentForMcp(row: unknown, include: string[] = []): unknown {
  if (!row || typeof row !== 'object') return row;
  const src = row as AnyRecord;
  if (include.includes('all')) return src;
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(src)) {
    if (include.includes(k)) {
      out[k] = v;
      continue;
    }
    if (COMPONENT_HEAVY_FIELDS.has(k)) continue;
    if (/^figma/i.test(k)) {
      if (include.includes('figma')) out[k] = v; // internal Figma sync metadata
      continue;
    }
    out[k] = v;
  }
  out._note =
    'Slimmed: excludes sharedStyles (the full compiled DS CSS), validationResults, and Figma ' +
    'sync metadata. include:["figma"] adds Figma fields, include:["all"] returns the raw row, ' +
    'or pass any field name to re-add it. Foundation tokens → handoff_get_tokens.';
  return out;
}

export function createHandoffMcpServer(auth: McpAuthContext, request: Request): McpServer {
  const server = new McpServer({ name: 'handoff', version: '2.0.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    'handoff_get_project_context',
    {
      description: 'Project hydration: stack profile, paths, Figma key, translation hints.',
      inputSchema: {
        projectName: z.string().optional(),
        stackProfile: z.string().optional(),
      },
    },
    async ({ projectName, stackProfile }) => {
      const profile = buildProjectContext({ projectName, stackProfile });
      const origin = issuerForCliSync(request);
      const workspace = await getDesignWorkspace();
      return textResult({
        ...profile,
        handoffOrigin: origin,
        referenceIds: REFERENCE_MATERIAL_IDS,
        referenceEndpoint: `${origin}/api/handoff/reference-materials`,
        workspace: formatDesignWorkspaceForMcp(workspace),
      });
    }
  );

  server.registerTool(
    'handoff_get_stack_guide',
    {
      description: 'Markdown authoring rules for the active stack (bootstrap-handlebars, react-tailwind, react-scss).',
      inputSchema: { stackProfile: z.string().optional() },
    },
    async ({ stackProfile }) => {
      const profile = resolveStackProfile(stackProfile);
      return textResult(loadStackGuideMarkdown(profile));
    }
  );

  server.registerTool(
    'handoff_get_reference',
    {
      description:
        'Fetch generated reference material by id: catalog | tokens | icons | property-patterns. ' +
        '(May also be passed as "type".)',
      inputSchema: {
        id: z.enum(['catalog', 'tokens', 'icons', 'property-patterns']).optional(),
        type: z
          .enum(['catalog', 'tokens', 'icons', 'property-patterns'])
          .optional()
          .describe('Alias for id.'),
      },
    },
    async ({ id, type }) => {
      const ref = id ?? type;
      if (!ref || !isReferenceMaterialId(ref)) {
        return textResult({
          error: 'Missing or invalid reference id. Use id (or type): catalog | tokens | icons | property-patterns.',
        });
      }
      const row = await getReferenceMaterialById(ref);
      if (!row) return textResult({ error: 'Not found — regenerate reference materials in admin' });
      return textResult({ id: row.id, content: row.content, generatedAt: row.generatedAt, metadata: row.metadata });
    }
  );

  server.registerTool(
    'handoff_get_design_guidelines',
    {
      description: 'Team Design.MD guidelines from design workspace settings.',
      inputSchema: {},
    },
    async () => {
      const denied = requireScope(auth, 'reference:read');
      if (denied) return denied;
      const ws = await getDesignWorkspace();
      return textResult({ designMd: ws.designMd, updatedAt: ws.updatedAt });
    }
  );

  server.registerTool(
    'handoff_get_brand_voice',
    {
      description: 'Formatted brand voice / copy guidelines from design workspace.',
      inputSchema: {},
    },
    async () => {
      const denied = requireScope(auth, 'reference:read');
      if (denied) return denied;
      const ws = await getDesignWorkspace();
      return textResult({
        brandVoice: ws.brandVoice,
        markdown: formatBrandVoiceForPrompt(ws.brandVoice),
        updatedAt: ws.updatedAt,
      });
    }
  );

  server.registerTool(
    'handoff_get_component_reference',
    {
      description: 'Component style reference image for a slot: buttons | inputs | iconography.',
      inputSchema: { slot: z.enum(['buttons', 'inputs', 'iconography']) },
    },
    async ({ slot }) => {
      const denied = requireScope(auth, 'design:read');
      if (denied) return denied;
      const ws = await getDesignWorkspace();
      const ref = ws.componentReferences[slot];
      const setting = COMPONENT_REFERENCE_SETTINGS.find((s) => s.id === slot);
      if (!ref?.imageUrl?.trim()) {
        return textResult({ slot, imageUrl: null, hint: `No ${setting?.label ?? slot} reference uploaded in design workspace.` });
      }
      const url = ref.imageUrl.trim();
      let imageBase64: string | null = null;
      const dataMatch = url.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
      if (dataMatch) imageBase64 = dataMatch[1];
      return textResult({
        slot,
        label: setting?.label ?? slot,
        imageUrl: url.startsWith('data:') ? '(data URL — use imageBase64)' : url,
        imageBase64,
        updatedAt: ref.updatedAt ?? ws.updatedAt,
      });
    }
  );

  server.registerTool(
    'handoff_search_components',
    {
      description: 'Search component catalog by id, title, group, or tag substring.',
      inputSchema: {
        query: z.string().optional(),
        group: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ query, group, limit }) => {
      const provider = getDataProvider();
      let list = await provider.getComponents();
      const q = query?.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            (c.title || '').toLowerCase().includes(q) ||
            (c.group || '').toLowerCase().includes(q) ||
            JSON.stringify(c.tags ?? []).toLowerCase().includes(q)
        );
      }
      if (group?.trim()) {
        list = list.filter((c) => (c.group || '').toLowerCase() === group.trim().toLowerCase());
      }
      const cap = limit ?? 50;
      return textResult(list.slice(0, cap).map((c) => ({ id: c.id, title: c.title, group: c.group, type: c.type })));
    }
  );

  server.registerTool(
    'handoff_get_component',
    {
      description:
        'Component implementation data by id — code/html/sass/css, properties, variants, and ' +
        'usage guidance. Slimmed for context use: excludes the compiled sharedStyles CSS ' +
        '(~97% of the raw row), validationResults, and Figma sync metadata.',
      inputSchema: {
        id: z.string(),
        include: z
          .array(z.string())
          .optional()
          .describe('Re-add excluded fields by name, "figma" for all Figma metadata, or "all" for the raw row.'),
      },
    },
    async ({ id, include }) => {
      const provider = getDataProvider();
      const row = await provider.getComponent(id.trim());
      if (!row) return textResult({ error: 'Not found' });
      return textResult(slimComponentForMcp(row, include ?? []));
    }
  );

  server.registerTool(
    'handoff_get_tokens',
    {
      description:
        'Foundation design tokens (colors, typography, effects, and any spacing/radius/grid when extracted). ' +
        'Slimmed for context use — excludes icon/logo SVGs, per-component token usage, and the SCSS $map. ' +
        'Use handoff_get_icon_catalog/handoff_get_logo_set/handoff_get_component for those.',
      inputSchema: {
        include: z
          .array(z.enum(['assets', 'components', 'map']))
          .optional()
          .describe('Opt back into heavy raw sections normally excluded. Default: none.'),
      },
    },
    async ({ include }) => {
      return textResult(await collectFoundationTokens(getDataProvider(), include ?? []));
    }
  );

  server.registerTool(
    'handoff_export_design_md',
    {
      description:
        'Export a compact DESIGN.md framing brief for this design system — system identity, token ' +
        'brief (colors/type/spacing/radius/grid), component vocabulary, brand voice, and design ' +
        'guidelines. Commit it to a project and reference it from CLAUDE.md so an agent has design-' +
        'system context without a live MCP call.',
      inputSchema: {},
    },
    async () => {
      const provider = getDataProvider();
      const [foundation, components, ws] = await Promise.all([
        collectFoundationTokens(provider, []),
        provider.getComponents(),
        getDesignWorkspace(),
      ]);
      const profile = buildProjectContext({});
      const asArr = (v: unknown): AnyRecord[] => (Array.isArray(v) ? (v as AnyRecord[]) : []);
      const md = buildDesignMd({
        project: {
          name: profile.name,
          stackProfile: profile.stackProfile,
          figmaFileKey: profile.figmaFileKey,
          origin: issuerForCliSync(request),
        },
        colors: asArr(foundation.colors),
        typography: asArr(foundation.typography),
        spacing: asArr(foundation.spacing),
        borderRadius: asArr(foundation.borderRadius),
        grid: asArr(foundation.grid),
        components: (components ?? []).map((c) => ({ id: c.id, title: c.title, group: c.group })),
        brandVoiceMarkdown: formatBrandVoiceForPrompt(ws.brandVoice),
        designGuidelines: ws.designMd,
      });
      return textResult({ designMd: md });
    }
  );

  server.registerTool(
    'handoff_sync_status',
    { description: 'Remote sync cursor and health. Returns workspace-mode notice if no registry is connected.', inputSchema: {} },
    async () => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const { getSyncStatus } = await import('@/lib/db/sync-queries');
      return textResult(await getSyncStatus());
    }
  );

  server.registerTool(
    'handoff_sync_pull',
    {
      description: 'Fetch sync changes since cursor (JSON patches for local apply). Registry mode only.',
      inputSchema: { since: z.number().int().min(0).optional() },
    },
    async ({ since }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const changeset = await fetchSyncChangesSince(since ?? 0);
      return textResult(changeset);
    }
  );

  server.registerTool(
    'handoff_sync_push',
    {
      description: 'Upload sync changes (requires sync:write). Registry mode only.',
      inputSchema: {
        body: z.object({
          changes: z.array(
            z.object({
              entityType: z.enum(['page', 'component', 'pattern']),
              entityId: z.string(),
              action: z.enum(['create', 'update', 'delete']),
              data: z.record(z.string(), z.unknown()).optional(),
            })
          ),
        }),
      },
    },
    async ({ body }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      if (!auth.isLegacySecret && !auth.scopes.includes('sync:write')) {
        return textResult({ error: 'Forbidden — sync:write required' });
      }
      const applied: string[] = [];
      for (const ch of body.changes ?? []) {
        await applyUploadedChange({
          entityType: ch.entityType,
          entityId: ch.entityId,
          action: ch.action,
          data: (ch.data as Record<string, unknown>) ?? null,
          userId: auth.userId === 'service' ? null : auth.userId,
        });
        applied.push(`${ch.entityType}:${ch.entityId}`);
      }
      return textResult({ ok: true, appliedCount: applied.length, applied });
    }
  );

  server.registerTool(
    'handoff_list_design_artifacts',
    {
      description: 'List saved design library artifacts. Registry mode only.',
      inputSchema: { status: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ status, limit }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const { getDesignArtifacts } = await import('@/lib/db/queries');
      const isAdmin = auth.role === 'admin';
      const rows = await getDesignArtifacts({
        userId: isAdmin ? undefined : auth.userId,
        status: status?.trim(),
        limit: limit ?? 30,
      });
      return textResult(rows);
    }
  );

  server.registerTool(
    'handoff_get_design_artifact',
    {
      description: 'Get design artifact by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { getDesignArtifactById } = await import('@/lib/db/queries');
      const row = await getDesignArtifactById(id.trim());
      if (!row) return textResult({ error: 'Not found' });
      return textResult(row);
    }
  );

  server.registerTool(
    'handoff_create_design_artifact',
    {
      description: 'Create design artifact with base64 image (design:write).',
      inputSchema: {
        title: z.string().optional(),
        description: z.string().optional(),
        imageBase64: z.string(),
        status: z.string().optional(),
      },
    },
    async ({ title, description, imageBase64, status }) => {
      if (auth.userId === 'service') {
        return textResult({ error: 'Use device login JWT for design:write, not sync secret alone.' });
      }
      const { insertDesignArtifact } = await import('@/lib/db/queries');
      const mimeMatch = imageBase64.match(/^data:([^;]+);base64,/);
      const raw = mimeMatch ? imageBase64.slice(mimeMatch[0].length) : imageBase64;
      const mime = mimeMatch?.[1] ?? 'image/png';
      const imageUrl = `data:${mime};base64,${raw.replace(/\s/g, '')}`;
      const id = await insertDesignArtifact({
        title: title?.trim() || 'Untitled',
        description: description?.trim() || '',
        status: status?.trim() || 'draft',
        userId: auth.userId,
        imageUrl,
      });
      return textResult({ id });
    }
  );

  server.registerTool(
    'handoff_get_component_spec',
    {
      description: 'Get the component specification (structured spec + editable markdown) for a saved design artifact. Returns the full ComponentSpec JSON and the rendered markdown for use in local component generation.',
      inputSchema: {
        artifactId: z.string().describe('ID of the saved design artifact'),
      },
    },
    async ({ artifactId }) => {
      const { getDesignArtifactById } = await import('@/lib/db/queries');
      const artifact = await getDesignArtifactById(artifactId.trim());
      if (!artifact) return textResult({ error: 'Design not found' });
      const specStatus = typeof artifact.specStatus === 'string' ? artifact.specStatus : 'none';
      if (specStatus === 'none' || specStatus === 'failed') {
        return textResult({
          error: 'No spec available. Use regenerate_spec on the design detail page, or call handoff_generate_component_from_design to queue generation.',
          specStatus,
          artifactId: artifact.id,
          title: artifact.title,
        });
      }
      if (specStatus === 'pending' || specStatus === 'generating') {
        return textResult({ specStatus, message: 'Spec generation is in progress. Try again shortly.', artifactId: artifact.id });
      }
      return textResult({
        artifactId: artifact.id,
        title: artifact.title,
        specStatus,
        componentSpec: artifact.componentSpec ?? null,
        componentSpecMd: artifact.componentSpecMd ?? null,
        imageUrl: artifact.imageUrl,
        assets: Array.isArray(artifact.assets) ? artifact.assets : [],
      });
    }
  );

  server.registerTool(
    'handoff_generate_component_from_design',
    {
      description: 'Fetch a design artifact\'s spec and extracted assets to generate a component locally. If no spec exists yet, queues server-side spec generation. Returns the full spec, markdown, image URLs, and stack guide context for you to implement the component in the local codebase.',
      inputSchema: {
        artifactId: z.string().describe('ID of the saved design artifact'),
        queueSpecIfMissing: z.boolean().optional().describe('If true (default), queue spec generation when none exists'),
      },
    },
    async ({ artifactId, queueSpecIfMissing = true }) => {
      const { getDesignArtifactById, updateDesignArtifactById } = await import('@/lib/db/queries');
      const artifact = await getDesignArtifactById(artifactId.trim());
      if (!artifact) return textResult({ error: 'Design not found' });

      const specStatus = typeof artifact.specStatus === 'string' ? artifact.specStatus : 'none';

      if ((specStatus === 'none' || specStatus === 'failed') && queueSpecIfMissing) {
        try {
          const { scheduleSpecGeneration } = await import('@/lib/server/design-asset-schedule');
          await updateDesignArtifactById(artifact.id, { specStatus: 'pending' } as Parameters<typeof updateDesignArtifactById>[1]);
          scheduleSpecGeneration(artifact.id);
          return textResult({
            message: 'Spec generation queued. Call handoff_get_component_spec in ~30 seconds to retrieve it.',
            specStatus: 'pending',
            artifactId: artifact.id,
            title: artifact.title,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return textResult({ error: `Could not queue spec generation: ${msg}` });
        }
      }

      if (specStatus === 'pending' || specStatus === 'generating') {
        return textResult({ message: 'Spec is still generating. Call handoff_get_component_spec shortly.', specStatus, artifactId: artifact.id });
      }

      const assets = (Array.isArray(artifact.assets) ? artifact.assets : []) as { key?: string; label: string; imageUrl: string; prompt?: string }[];
      return textResult({
        artifactId: artifact.id,
        title: artifact.title,
        description: artifact.description,
        specStatus,
        componentSpec: artifact.componentSpec ?? null,
        componentSpecMd: artifact.componentSpecMd ?? null,
        imageUrl: artifact.imageUrl,
        assets: assets.map((a) => ({ key: a.key, label: a.label, imageUrl: a.imageUrl })),
        hint: 'Use componentSpecMd as your implementation brief. Implement the component locally using the props, variants, behavior, and accessibility requirements from componentSpec. The imageUrl is the reference design.',
      });
    }
  );

  server.registerTool(
    'handoff_enqueue_build',
    {
      description: 'DEPRECATED — server-side builds retired. Builds run locally via `handoff-app build`. Returns workspace-mode notice.',
      inputSchema: { componentId: z.string() },
    },
    async ({ componentId: _componentId }) => {
      return textResult({ ...WORKSPACE_MODE_RESPONSE, message: 'Server-side builds are retired. Run `handoff-app build [id]` locally then push.' });
    }
  );

  server.registerTool(
    'handoff_list_reference_materials',
    {
      description: 'List reference material ids and sizes.',
      inputSchema: {},
    },
    async () => {
      const rows = await listReferenceMaterials();
      return textResult(
        rows.map((r) => ({ id: r.id, contentLength: r.content.length, generatedAt: r.generatedAt }))
      );
    }
  );

  // ── Asset inventory tools ──────────────────────────────────────────────────

  server.registerTool(
    'handoff_search_assets',
    {
      description: 'Search the asset library. Returns logos, icons, and images with URLs and metadata.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search against title and tags'),
        type: z.enum(['logo', 'icon', 'image', 'video']).optional().describe('Filter by asset type'),
        collection_id: z.string().optional().describe('Filter by collection ID'),
        icon_set_id: z.string().optional().describe('Filter by icon set ID'),
        tags: z.array(z.string()).optional().describe('Filter to assets with all of these tags'),
        limit: z.number().int().min(1).max(200).optional().describe('Max results (default 50)'),
      },
    },
    async ({ query, type, collection_id, icon_set_id, tags, limit }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const assets = await listAssets({
        search: query,
        assetType: type,
        collectionId: collection_id,
        iconSetId: icon_set_id,
        tags,
        limit: limit ?? 50,
        status: 'active',
      });
      return textResult(assets);
    }
  );

  server.registerTool(
    'handoff_get_asset',
    {
      description: 'Get full details for a single asset including component usages and size info.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const asset = await getAssetWithUsages(id);
      if (!asset) return textResult({ error: 'Not found' });
      return textResult(asset);
    }
  );

  server.registerTool(
    'handoff_list_asset_collections',
    {
      description: 'List all asset collections (Figma sections or manually created groups).',
      inputSchema: {},
    },
    async () => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const collections = await listAssetCollections();
      return textResult(collections);
    }
  );

  // ── Icon catalog tools (DataProvider-backed) ──────────────────────────────

  server.registerTool(
    'handoff_get_icon_catalog',
    {
      description:
        'Return the full icon catalog as defined in the design system. Optionally filter by category. ' +
        'Each entry includes id, name, description, category, tags, usage guidance, and source (SVG content or iconify/fa-pro reference).',
      inputSchema: {
        category: z.string().optional().describe('Filter to a specific category (case-insensitive exact match)'),
      },
    },
    async ({ category }) => {
      const provider = getDataProvider();
      let catalog = await provider.getIconCatalog();
      if (category?.trim()) {
        const cat = category.trim().toLowerCase();
        catalog = catalog.filter((e) => e.category.toLowerCase() === cat);
      }
      return textResult(catalog);
    }
  );

  server.registerTool(
    'handoff_search_icons',
    {
      description:
        'Search the icon catalog by name, tag, or description substring. ' +
        'Returns matching IconCatalogEntry objects including SVG content where available.',
      inputSchema: {
        query: z.string().describe('Substring to match against icon name, tags, or description'),
        category: z.string().optional().describe('Narrow results to a specific category (case-insensitive)'),
        limit: z.number().int().min(1).max(500).optional().describe('Max results (default 100)'),
      },
    },
    async ({ query, category, limit }) => {
      const provider = getDataProvider();
      let catalog = await provider.getIconCatalog();
      const q = query.trim().toLowerCase();
      catalog = catalog.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
      if (category?.trim()) {
        const cat = category.trim().toLowerCase();
        catalog = catalog.filter((e) => e.category.toLowerCase() === cat);
      }
      const cap = limit ?? 100;
      return textResult(catalog.slice(0, cap));
    }
  );

  server.registerTool(
    'handoff_get_logo_set',
    {
      description:
        'Return all logo variants for the design system, including SVG content, usage guidance, and variant metadata ' +
        '(light/dark/color/mono, primary/alternate/wordmark/icon-only). Optionally filter by variant or form.',
      inputSchema: {
        variant: z
          .string()
          .optional()
          .describe('Filter by variant value (e.g. "light", "dark", "color", "mono", "reversed")'),
        form: z
          .string()
          .optional()
          .describe('Filter by form value (e.g. "primary", "alternate", "wordmark", "icon-only")'),
      },
    },
    async ({ variant, form }) => {
      const provider = getDataProvider();
      const logoSet = await provider.getLogoSet();
      if (!logoSet) return textResult({ error: 'No logo set available' });
      let variants = logoSet.variants;
      if (variant?.trim()) {
        const v = variant.trim().toLowerCase();
        variants = variants.filter((lv) => lv.variant.toLowerCase() === v);
      }
      if (form?.trim()) {
        const f = form.trim().toLowerCase();
        variants = variants.filter((lv) => lv.form.toLowerCase() === f);
      }
      return textResult({ ...logoSet, variants });
    }
  );

  return server;
}
