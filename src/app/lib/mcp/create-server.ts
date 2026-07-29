import 'server-only';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { buildProjectContext, resolveStackProfile } from '@/lib/mcp/project-profile';
import { buildDesignMd } from '@handoff/utils/design-md';
import { loadStackGuideMarkdown } from '@/lib/mcp/stack-guides';
import { getReferenceMaterialById, listReferenceMaterials } from '@/lib/db/queries';
import { isReferenceMaterialId, REFERENCE_MATERIAL_IDS } from '@/lib/server/reference-material-ids';
import { getDataProvider } from '@/lib/data';
import type { DtcgTokenType, DtcgTokenStrings } from '@/lib/data/types';
import { usePostgres } from '@/lib/db/dialect';
import { fetchSyncChangesSince } from '@/lib/db/sync-queries';
import { applyUploadedChange } from '@/lib/db/sync-queries';
import { getUnifiedChangelog, type UnifiedChangelogEntry } from '@/lib/db/changelog-queries';
import { getComponentVersionHistory } from '@/lib/db/component-version-queries';
import { resolveChangeWhy } from '@/lib/server/change-why';
import { writePattern, patchPattern, type PatternWriteActor } from '@/lib/db/pattern-write';
import { computePermissions, isAuthorizationError, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { validatePreviewValues } from '@handoff/transformers/preview/component/preview-validation';
import {
  createComponentPreview,
  updateComponentPreview,
  listComponentPreviews,
  PreviewValidationFailed,
} from '@/lib/db/component-preview-queries';
import { deleteDocPage, getHandoffPageBySlug, listHandoffPages, moveDocPage, writeDocPage, type DocPageActor } from '@/lib/server/doc-pages';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { COMPONENT_PREVIEW_APP_JS_B64 } from '@/lib/mcp/apps/component-preview.bundle';
import { TOKEN_PALETTE_APP_JS_B64 } from '@/lib/mcp/apps/token-palette.bundle';
import { COMPONENT_GALLERY_APP_JS_B64 } from '@/lib/mcp/apps/component-gallery.bundle';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { jwtScopesInclude } from '@/lib/cli-sync-jwt';
import {
  formatBrandVoiceForPrompt,
  formatDesignWorkspaceForMcp,
  getDesignWorkspace,
} from '@/lib/server/design-workspace';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';
import type { DesignGenerationRequestParams } from '@/lib/server/design-generation-worker';
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

/** Compact a unified changelog entry for MCP — what changed, who, when, and the "why". */
function summarizeChange(e: UnifiedChangelogEntry) {
  if (e.entityType === 'component') {
    return {
      type: 'component',
      id: e.id,
      component: e.componentId,
      title: e.componentTitle,
      version: e.versionNumber,
      when: e.pushedAt,
      who: e.pushedByName,
      trigger: e.trigger,
      changed: e.changeSummary,
      why: e.message ?? e.aiSummary ?? null,
    };
  }
  if (e.entityType === 'token') {
    return {
      type: 'token',
      id: e.id,
      when: e.pushedAt,
      who: e.pushedByName,
      trigger: e.trigger,
      added: e.addedCount,
      modified: e.modifiedCount,
      removed: e.removedCount,
      modifiedKeys: e.modifiedKeys.slice(0, 20),
      why: e.message ?? e.aiSummary ?? null,
    };
  }
  if (e.entityType === 'pattern') {
    return {
      type: 'pattern',
      id: e.id,
      page: e.patternId,
      title: e.title,
      action: e.action,
      blocks: e.blockCount,
      when: e.pushedAt,
      who: e.pushedByName,
      trigger: e.trigger,
      why: e.message ?? e.aiSummary ?? null,
    };
  }
  return {
    type: 'page',
    id: e.id,
    slug: e.slug,
    action: e.pageAction,
    when: e.pushedAt,
    who: e.pushedByName,
    title: e.titleAfter ?? e.titleBefore ?? null,
    why: e.message ?? e.aiSummary ?? null,
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

/** Provider surface collectFoundationTokens needs (subset of DataProvider). */
type FoundationProvider = {
  getTokens(): Promise<unknown>;
  getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null>;
  getDtcgSource?(): Promise<import('handoff-core').Types.DtcgSource | null>;
};

/**
 * Slim Figma-snapshot tokens + merged DTCG dimension tokens (spacing/radius/grid).
 *
 * P1.6b — when the registry has a multi-axis source tree, `out.axes` advertises the
 * available axes (brand, scheme, …). If `selector` names any axis, the source is
 * resolved against it (Dtcg.resolveTokens) and the per-selector color/typography/
 * effect tokens are attached under `out.axisTokens` — so an MCP consumer can pull
 * "resolvet / dark" without knowing the reference graph. Absent a source, behavior
 * is unchanged (brand/scheme-agnostic).
 */
async function collectFoundationTokens(
  provider: FoundationProvider,
  include: string[] = [],
  selector: Record<string, string> = {}
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

  // Multi-axis resolution (query/viz path only; never the theme.css hot path).
  let source: import('handoff-core').Types.DtcgSource | null = null;
  try {
    source = provider.getDtcgSource ? await provider.getDtcgSource() : null;
  } catch {
    source = null;
  }
  if (source) {
    out.axes = source.axes;
    const activeSelector: Record<string, string> = {};
    for (const [k, v] of Object.entries(selector)) {
      if (v) activeSelector[k] = v;
    }
    if (Object.keys(activeSelector).length > 0) {
      try {
        const { Dtcg } = await import('handoff-core');
        const { normalizeDtcgToLocalStyles } = await import('@/lib/dtcg-normalizer');
        const resolved = Dtcg.resolveTokens(source, activeSelector) as Record<string, unknown>;
        const normalized = normalizeDtcgToLocalStyles(resolved);
        out.axisSelector = activeSelector;
        out.axisTokens = { color: normalized.color, typography: normalized.typography, effect: normalized.effect };
      } catch (err) {
        out.axisSelector = activeSelector;
        out.axisError = err instanceof Error ? err.message : 'Axis resolution failed';
      }
    }
  }
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
  // `resources` capability is required for the MCP Apps (Track 6.2) ui:// resource
  // the host fetches via resources/read.
  const server = new McpServer({ name: 'handoff', version: '2.0.0' }, { capabilities: { tools: {}, resources: {} } });

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
        'Use handoff_get_icon_catalog/handoff_get_logo_set/handoff_get_component for those. ' +
        'Multi-axis (brand × scheme): the response advertises available `axes`; pass brand/scheme to get ' +
        'axis-resolved tokens under `axisTokens`.',
      inputSchema: {
        include: z
          .array(z.enum(['assets', 'components', 'map']))
          .optional()
          .describe('Opt back into heavy raw sections normally excluded. Default: none.'),
        brand: z.string().optional().describe('Brand axis value to resolve tokens for (see `axes` in the response).'),
        scheme: z.string().optional().describe('Scheme axis value, e.g. "light"/"dark" (see `axes` in the response).'),
      },
    },
    async ({ include, brand, scheme }) => {
      const selector: Record<string, string> = {};
      if (brand) selector.brand = brand;
      if (scheme) selector.scheme = scheme;
      return textResult(await collectFoundationTokens(getDataProvider(), include ?? [], selector));
    }
  );

  server.registerTool(
    'handoff_export_design_md',
    {
      description:
        'Export a compact DESIGN.md framing brief for this design system — system identity, token ' +
        'brief (colors/type/spacing/radius/grid), component vocabulary, brand voice, and design ' +
        'guidelines. Commit it to a project and reference it from CLAUDE.md so an agent has design-' +
        'system context without a live MCP call. For a multi-axis system, pass brand/scheme to frame ' +
        'the brief around that resolved theme.',
      inputSchema: {
        brand: z.string().optional().describe('Brand axis value to frame the brief around (multi-axis systems).'),
        scheme: z.string().optional().describe('Scheme axis value, e.g. "light"/"dark" (multi-axis systems).'),
      },
    },
    async ({ brand, scheme }) => {
      const provider = getDataProvider();
      const selector: Record<string, string> = {};
      if (brand) selector.brand = brand;
      if (scheme) selector.scheme = scheme;
      const [foundation, components, ws] = await Promise.all([
        collectFoundationTokens(provider, [], selector),
        provider.getComponents(),
        getDesignWorkspace(),
      ]);
      const profile = buildProjectContext({});
      const asArr = (v: unknown): AnyRecord[] => (Array.isArray(v) ? (v as AnyRecord[]) : []);
      // Prefer axis-resolved colors/typography when a brand/scheme selector was given.
      const axisTokens = foundation.axisTokens as { color?: unknown; typography?: unknown } | undefined;
      const md = buildDesignMd({
        project: {
          name: profile.name,
          stackProfile: profile.stackProfile,
          figmaFileKey: profile.figmaFileKey,
          origin: issuerForCliSync(request),
        },
        colors: asArr(axisTokens?.color ?? foundation.colors),
        typography: asArr(axisTokens?.typography ?? foundation.typography),
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
      description:
        'Fetch a bounded page of sync changes since cursor (JSON patches for local apply). Registry mode only. ' +
        'Results are paginated: if the response has `hasMore: true`, pull again with `since` set to `nextCursor` and repeat until `hasMore` is false to drain the full feed.',
      inputSchema: {
        since: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async ({ since, limit }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const changeset = await fetchSyncChangesSince(since ?? 0, limit);
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

  // ─── Design-artifact authorization ───────────────────────────────────────────
  // Design artifacts are per-user resources. The MCP path must enforce the SAME
  // gates as the browser path, or the authz layer is bypassable simply by asking
  // Claude instead of clicking (the exact bypass `pattern-write.ts` guards against
  // for patterns). Reference: app/api/handoff/ai/design-artifact/route.ts +
  // .../[id]/route.ts.

  /**
   * MCP caller → authz actor. Synthetic ids ('service'/'workspace') are not real
   * users, so they carry a null userId and rely on their 'admin' role for access
   * (workspace/CLI sync keeps working). Shared with `patternActor` so the two
   * can't drift.
   */
  const authzActor = (): MutateActor => ({
    userId: auth.userId && auth.userId !== 'service' && auth.userId !== 'workspace' ? auth.userId : null,
    role: auth.role ?? null,
  });

  /**
   * Effective access to one design artifact, mirroring the HTTP routes:
   *  - baseline gate is **owner-or-admin** (`isOwnerOrAdmin`). Grants/visibility
   *    are deliberately NOT an access-widening path for artifacts yet — the HTTP
   *    routes defer that to the "Stage 3 cutover", so MCP must not be more
   *    permissive than the UI.
   *  - `perms` (from `computePermissions`) carries the finer lifecycle checks —
   *    notably `canApprove`, which is maintainer-only.
   * Returns null when the artifact does not exist.
   */
  async function designArtifactAccess(artifactId: string) {
    const { getResourceOwner, getActorGrant } = await import('@/lib/db/grant-queries');
    const owner = await getResourceOwner('design_artifact', artifactId);
    if (!owner) return null;
    const actor = authzActor();
    const grant = actor.userId ? await getActorGrant('design_artifact', artifactId, actor.userId) : null;
    const perms = computePermissions(
      actor,
      { ownerUserId: owner.ownerUserId, visibility: toVisibility(owner.visibility) },
      grant
    );
    const isOwnerOrAdmin =
      actor.role === 'admin' || (owner.ownerUserId != null && actor.userId != null && owner.ownerUserId === actor.userId);
    return { ownerUserId: owner.ownerUserId, visibility: owner.visibility, perms, isOwnerOrAdmin };
  }

  /**
   * Guard for reads/writes of a design artifact. Returns a ready-to-return error
   * result when denied, or null when allowed. Denials mirror the HTTP routes and
   * report "not found" rather than "forbidden" so a non-owner can't probe which
   * artifact ids exist.
   */
  async function denyArtifactAccess(
    artifactId: string,
    need: 'view' | 'edit' | 'approve'
  ): Promise<{ content: { type: 'text'; text: string }[] } | null> {
    const access = await designArtifactAccess(artifactId);
    if (!access || !access.isOwnerOrAdmin) return textResult({ error: 'Design not found' });
    if (need === 'edit' && !access.perms.canEdit) {
      return textResult({ error: 'Forbidden — you do not have permission to modify this design.' });
    }
    if (need === 'approve' && !access.perms.canApprove) {
      return textResult({ error: 'Forbidden — only a maintainer can approve a design.' });
    }
    return null;
  }

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
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = await denyArtifactAccess(id.trim(), 'view');
      if (denied) return denied;
      const { getDesignArtifactById } = await import('@/lib/db/queries');
      const row = await getDesignArtifactById(id.trim());
      if (!row) return textResult({ error: 'Not found' });
      // Stamp effective permissions so the caller can reason about lifecycle
      // (e.g. whether it may approve) instead of guessing — mirrors the HTTP route.
      const access = await designArtifactAccess(id.trim());
      // One derived answer to "is this ready for dev?", so a caller polling the handoff does
      // not have to interpret assetsStatus and specStatus separately.
      const { devHandoffStatusForRow } = await import('@/lib/server/dev-handoff');
      return textResult({ ...row, permissions: access?.perms ?? null, devHandoff: devHandoffStatusForRow(row) });
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
      // Mirror the design-artifact route: asset extraction runs locally only when
      // the server holds the OpenAI key (extractor requires HANDOFF_AI_API_KEY).
      const canExtractLocally = Boolean(process.env.HANDOFF_AI_API_KEY?.trim());
      const id = await insertDesignArtifact({
        title: title?.trim() || 'Untitled',
        description: description?.trim() || '',
        status: status?.trim() || 'draft',
        userId: auth.userId,
        imageUrl,
        assetsStatus: canExtractLocally ? 'pending' : 'none',
      });
      if (canExtractLocally && id) {
        // NOTE: scheduleDesignAssetExtraction uses next/server after(). Under the
        // MCP transport this fires after the tool response the same way it does on
        // the HTTP route; verify live that extraction actually runs in-cloud. If
        // after() proves unreliable here, promote this to the design-jobs cron.
        const { scheduleDesignAssetExtraction } = await import('@/lib/server/design-asset-schedule');
        scheduleDesignAssetExtraction(id);
      }
      return textResult({ id, ...(canExtractLocally ? { assetsStatus: 'pending' } : {}) });
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
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = await denyArtifactAccess(artifactId.trim(), 'view');
      if (denied) return denied;
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
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = await denyArtifactAccess(artifactId.trim(), 'view');
      if (denied) return denied;
      const { getDesignArtifactById, updateDesignArtifactById } = await import('@/lib/db/queries');
      const artifact = await getDesignArtifactById(artifactId.trim());
      if (!artifact) return textResult({ error: 'Design not found' });

      const specStatus = typeof artifact.specStatus === 'string' ? artifact.specStatus : 'none';

      if ((specStatus === 'none' || specStatus === 'failed') && queueSpecIfMissing) {
        // Queuing mutates the artifact (specStatus) and spends AI credits on it,
        // so it needs edit rights — not just view.
        const deniedEdit = await denyArtifactAccess(artifactId.trim(), 'edit');
        if (deniedEdit) return deniedEdit;
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
    'handoff_set_design_status',
    {
      description:
        'Set a design artifact\'s lifecycle status (draft → review → approved). Moving to review or approved ' +
        'kicks off server-side asset extraction + spec generation (when server AI is configured), so the ' +
        'artifact\'s spec/assets are ready for handoff_generate_component_from_design.',
      inputSchema: {
        artifactId: z.string(),
        status: z.enum(['draft', 'review', 'approved']),
      },
    },
    async ({ artifactId, status }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      // Lifecycle gate, mirroring design-artifact/route.ts: 'approved' is
      // maintainer-only (`canApprove`); other transitions need edit rights.
      const deniedAccess = await denyArtifactAccess(artifactId.trim(), status === 'approved' ? 'approve' : 'edit');
      if (deniedAccess) return deniedAccess;
      const { updateDesignArtifactById } = await import('@/lib/db/queries');
      const ok = await updateDesignArtifactById(artifactId.trim(), { status });
      if (!ok) return textResult({ ok: false, error: 'Design not found' });
      // Mirror the design-artifact route (:108-110): run the dev handoff on review/approved,
      // but only when the server can extract locally. Mark it queued first so both statuses
      // read as in-flight immediately — otherwise extraction is skipped (it only claims rows
      // already in `pending`) and a poller sees a stale status from the previous run.
      if ((status === 'review' || status === 'approved') && process.env.HANDOFF_AI_API_KEY?.trim()) {
        const { markDevHandoffQueued } = await import('@/lib/server/dev-handoff');
        const { scheduleDevHandoff } = await import('@/lib/server/design-asset-schedule');
        await markDevHandoffQueued(artifactId.trim(), { clearAssets: false });
        scheduleDevHandoff(artifactId.trim());
      }
      return textResult({ ok: true, artifactId: artifactId.trim(), status });
    }
  );

  /**
   * Shared body for the dev handoff. `handoff_transition_to_dev` is the real tool;
   * `handoff_extract_design_assets` is kept as a deprecated alias so existing agent
   * transcripts and saved prompts keep working.
   */
  async function startDevHandoff(artifactId: string, extractAssets: boolean) {
    if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
    const denied = requireScope(auth, 'sync:write');
    if (denied) return denied;
    if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
      return textResult({ ok: false, error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' });
    }
    const id = artifactId.trim();
    // Spends AI credits on the artifact and overwrites its spec — edit rights required.
    const deniedAccess = await denyArtifactAccess(id, 'edit');
    if (deniedAccess) return deniedAccess;

    const stages = extractAssets ? (['assets', 'spec'] as const) : (['spec'] as const);

    const { markDevHandoffQueued, getDevHandoffStatus } = await import('@/lib/server/dev-handoff');
    const ok = await markDevHandoffQueued(id, { clearAssets: extractAssets, stages });
    if (!ok) return textResult({ ok: false, error: 'Design not found' });

    const { scheduleDevHandoff } = await import('@/lib/server/design-asset-schedule');
    scheduleDevHandoff(id, { stages });

    return textResult({
      ok: true,
      artifactId: id,
      stages,
      devHandoff: await getDevHandoffStatus(id),
      note: 'Poll handoff_get_design_artifact and read `devHandoff` for stage-level progress.',
    });
  }

  server.registerTool(
    'handoff_transition_to_dev',
    {
      description:
        'Transition a design artifact to developer-ready: extracts its assets (backgrounds, states, icons) ' +
        'and generates the full specification — props, behavior, accessibility, text inventory, design-token ' +
        'mapping against the registry\'s real tokens, and a brand-voice check of the copy. One operation; poll ' +
        'handoff_get_design_artifact and read `devHandoff` for stage-level progress (extracting_assets → ' +
        'generating_spec → ready). Read the result with handoff_get_component_spec.',
      inputSchema: {
        artifactId: z.string(),
        extractAssets: z
          .boolean()
          .optional()
          .describe(
            'Also run image asset extraction. Default FALSE — the current extraction path is being rebuilt and, because both stages share one invocation, running it starves specification of time. Only pass true if you specifically want to exercise extraction.'
          ),
      },
    },
    async ({ artifactId, extractAssets }) => startDevHandoff(artifactId, extractAssets === true)
  );

  server.registerTool(
    'handoff_extract_design_assets',
    {
      description:
        'DEPRECATED — use handoff_transition_to_dev, which this now forwards to. Runs the dev handoff ' +
        'for a design artifact.',
      inputSchema: { artifactId: z.string() },
    },
    // Forwards with extraction OFF, matching handoff_transition_to_dev's default: the alias exists
    // for compatibility, not to preserve a behavior we've established is harmful.
    async ({ artifactId }) => startDevHandoff(artifactId, false)
  );

  server.registerTool(
    'handoff_generate_design_image',
    {
      description:
        'Queue an AI design image generation (async). A durable background runner processes the job within ' +
        '~1 min; poll handoff_get_design_job for the result. Requires server AI to be configured.',
      inputSchema: {
        prompt: z.string(),
        quality: z.enum(['low', 'medium', 'high', 'auto']).optional(),
        componentGuides: z.array(z.any()).optional(),
        foundationContext: z.any().optional(),
        artifactId: z.string().optional().describe('Attach the job/result to an existing design artifact.'),
      },
    },
    async ({ prompt, quality, componentGuides, foundationContext, artifactId }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const { shouldProxyAi } = await import('@/lib/server/ai-client');
      if (!shouldProxyAi() && !process.env.HANDOFF_AI_API_KEY?.trim()) {
        return textResult({ ok: false, error: 'Server AI is not configured' });
      }
      // FK: design_generation_job.user_id → users.id, so a real user is required.
      // patternActor().userId is null for service/workspace callers; guard + use
      // the concrete auth.userId (mirrors handoff_create_design_artifact).
      const actorUserId = patternActor().userId;
      if (!actorUserId) {
        return textResult({ ok: false, error: 'Use device login JWT for design generation, not sync secret alone.' });
      }
      const { insertDesignGenerationJob } = await import('@/lib/db/queries');
      const requestParams: DesignGenerationRequestParams = {
        prompt,
        quality: quality ?? 'auto',
        iterationBaseUrl: null,
        conversationHistory: [],
        componentGuides: (componentGuides ?? []) as DesignGenerationRequestParams['componentGuides'],
        foundationContext: (foundationContext ?? { colors: [], typography: [], effects: [], spacing: [] }) as DesignGenerationRequestParams['foundationContext'],
        designGuidelines: '',
        brandVoiceGuidelines: '',
        promptImageCount: 0,
        attachedImages: [],
        customFoundationImage: null,
      };
      const jobId = await insertDesignGenerationJob({
        artifactId: artifactId?.trim() ?? null,
        userId: actorUserId,
        requestParams: requestParams as unknown as Record<string, unknown>,
      });
      return textResult({
        ok: true,
        jobId,
        status: 'pending',
        note: 'A background runner processes this within ~1 min — poll handoff_get_design_job.',
      });
    }
  );

  server.registerTool(
    'handoff_get_design_job',
    {
      description: 'Poll a design image generation job (from handoff_generate_design_image). Read-only.',
      inputSchema: { jobId: z.number().int() },
    },
    async ({ jobId }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const { getDesignGenerationJob } = await import('@/lib/db/queries');
      const job = await getDesignGenerationJob(jobId);
      if (!job) return textResult({ error: 'Job not found' });
      // Jobs are per-user and carry a generated imageUrl, so a caller may only
      // poll its OWN jobs (admins/service actors excepted). Reports "not found"
      // rather than "forbidden" so job ids can't be probed.
      const actor = authzActor();
      const ownsJob = actor.role === 'admin' || (actor.userId != null && job.userId === actor.userId);
      if (!ownsJob) return textResult({ error: 'Job not found' });
      return textResult({
        status: job.status,
        ...(job.imageUrl ? { imageUrl: job.imageUrl } : {}),
        ...(job.artifactId ? { artifactId: job.artifactId } : {}),
        ...(job.error ? { error: job.error } : {}),
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

  // ─── Change tracking / inquiry ─────────────────────────────────────────────

  server.registerTool(
    'handoff_recent_changes',
    {
      description:
        'Recent changes across the design system — component versions, token pushes, and doc-page ' +
        'edits — newest first. Each entry gives what changed, who pushed it, when, and the "why" ' +
        '(the push message, or a previously-drafted AI summary) when available. Use to answer ' +
        '"what changed recently/lately/since <when>". To get the reason behind a specific change ' +
        'that has no "why" yet, follow up with handoff_change_why using its type + id.',
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe('Look back this many days (default 14).'),
        limit: z.number().int().min(1).max(200).optional().describe('Max entries (default 30).'),
        entityType: z.enum(['component', 'token', 'page', 'pattern']).optional().describe('Filter to one kind of change.'),
      },
    },
    async ({ days, limit, entityType }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const since = new Date(Date.now() - (days ?? 14) * 86_400_000);
      const all = await getUnifiedChangelog(limit ?? 30, since);
      const filtered = entityType ? all.filter((e) => e.entityType === entityType) : all;
      return textResult(filtered.map(summarizeChange));
    }
  );

  server.registerTool(
    'handoff_component_history',
    {
      description:
        'Version history for one component (newest first): version number, when, who, what changed ' +
        '(metadata fields, source files, artifacts), and the "why" when recorded. Use to answer ' +
        '"what changed in <component>", "when did <component> last change", "how has it evolved".',
      inputSchema: {
        id: z.string().describe('Component id.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max versions (default 20).'),
      },
    },
    async ({ id, limit }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const versions = await getComponentVersionHistory(id.trim(), limit ?? 20);
      return textResult(
        versions.map((v) => ({
          id: v.id,
          version: v.versionNumber,
          when: v.pushedAt,
          who: v.pushedByName,
          trigger: v.trigger,
          changed: v.changeSummary,
          why: v.message ?? v.aiSummary ?? null,
        }))
      );
    }
  );

  server.registerTool(
    'handoff_change_why',
    {
      description:
        'The reason a specific change was made: returns the human-authored push message if present, ' +
        'otherwise generates and caches a one-sentence AI summary from the diff. Pass the change ' +
        'type and id as returned by handoff_recent_changes / handoff_component_history.',
      inputSchema: {
        entityType: z.enum(['component', 'token', 'page', 'pattern']),
        id: z.number().int().describe('The change id from handoff_recent_changes / handoff_component_history.'),
      },
    },
    async ({ entityType, id }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const result = await resolveChangeWhy({ entityType, id, actorUserId: null });
      return textResult(result);
    }
  );

  // ─── Playground pages (compositions / patterns) — Track 6.1 write surface ────

  /** MCP caller → pattern-write actor (drop synthetic ids from sync attribution). */
  const patternActor = (message?: string): PatternWriteActor => ({
    // Same actor identity the artifact gates use (`authzActor`) so pattern and
    // design-artifact enforcement can never drift apart.
    ...authzActor(),
    historyLabel: `mcp:${auth.userId}`,
    message: message ?? null,
    trigger: 'mcp',
  });

  /** MCP caller → doc-page actor. */
  const docPageActor = (message?: string): DocPageActor => ({
    userId: auth.userId && auth.userId !== 'service' && auth.userId !== 'workspace' ? auth.userId : null,
    userName: `mcp:${auth.userId}`,
    message: message ?? null,
    trigger: 'mcp',
  });

  const blockSchema = z.object({
    id: z.string().describe('Component id for this block'),
    preview: z.string().optional().describe('An existing preview key of that component to seed values'),
    args: z.record(z.string(), z.any()).optional().describe('Prop values for this block (validated against the component contract)'),
  });

  // ── Field-shape helpers (shared by contractReport + handoff_scaffold_args) ──
  // The authoring "shape" of a prop is driven by its editorType (falling back to
  // the inferred type/kind). These keep the scaffold, the shape warnings, and
  // the report speaking the same language.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorOf = (m: any): string => m?.editorType ?? m?.type ?? m?.kind ?? 'any';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isVisualSlot = (m: any) =>
    ['richtext', 'text', 'image', 'slot'].includes(m?.editorType) || m?.type === 'React.ReactNode' || m?.kind === 'slot';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shapeNote = (m: any): string => {
    switch (editorOf(m)) {
      case 'richtext': return 'HTML string, e.g. "<p>Copy with <b>bold</b></p>"';
      case 'text': case 'slot': case 'string': return 'string';
      case 'image': return '{ src, alt, width?, height? }';
      case 'button': return '{ label, href, variant? }';
      case 'link': return '{ label, href }';
      case 'select': case 'enum': return `one of: ${(m?.options ?? []).map((o: unknown) => JSON.stringify((o as { value?: unknown })?.value ?? o)).join(', ') || '(options)'}`;
      case 'boolean': return 'boolean';
      case 'number': return 'number';
      case 'array': return `array of ${m?.items?.editorType ?? m?.items?.type ?? 'items'}`;
      case 'object': return 'object';
      default: return editorOf(m);
    }
  };
  // A shape-correct placeholder value for a field, when no base-preview value exists.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placeholderValue = (m: any): unknown => {
    switch (editorOf(m)) {
      case 'richtext': return '<p>Placeholder copy</p>';
      case 'text': case 'slot': case 'string': return 'Text';
      case 'image': return { src: '', alt: '', width: 0, height: 0 };
      case 'button': return { label: 'Button', href: '#' };
      case 'link': return { label: 'Link', href: '#' };
      case 'select': case 'enum': { const o = m?.options?.[0]; return (o as { value?: unknown })?.value ?? o ?? ''; }
      case 'boolean': return false;
      case 'number': return 0;
      case 'array': return [];
      case 'object': return {};
      default: return null;
    }
  };
  // Flag a provided value whose JS shape doesn't match its editorType (renders wrong).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shapeMismatch = (m: any, v: unknown): string | null => {
    if (v == null) return null;
    const e = editorOf(m);
    const isObj = typeof v === 'object' && !Array.isArray(v);
    if (['richtext', 'text', 'slot', 'string'].includes(e) && typeof v !== 'string') return `expected a string (${e})`;
    if (e === 'image' && !isObj) return 'expected { src, alt, width?, height? }';
    if ((e === 'button' || e === 'link') && !isObj) return `expected ${shapeNote(m)}`;
    if (e === 'array' && !Array.isArray(v)) return 'expected an array';
    if (e === 'boolean' && typeof v !== 'boolean') return 'expected a boolean';
    if (e === 'number' && typeof v !== 'number') return 'expected a number';
    return null;
  };

  /**
   * Structured contract report for one value-set — the no-render "will this
   * render WELL?" signal (Phase 1a/1b verify). Beyond validity it surfaces:
   * visual slots left EMPTY (render blank — the #1 cause of a lifeless block),
   * out-of-contract keys, per-field editorType, and shapeWarnings (a provided
   * value whose JS shape doesn't match its editorType, e.g. an image given a
   * bare string). Use handoff_scaffold_args to get correctly-shaped values.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function contractReport(properties: Record<string, any> | undefined, args: Record<string, unknown> | undefined) {
    const props = properties ?? {};
    const provided = new Set(Object.keys(args ?? {}));
    const emptySlots: string[] = [];
    const fields: Record<string, string> = {};
    for (const [k, m] of Object.entries(props)) {
      fields[k] = editorOf(m);
      if (isVisualSlot(m) && !provided.has(k)) emptySlots.push(k);
    }
    const unknownKeys = [...provided].filter((k) => !(k in props));
    const shapeWarnings: string[] = [];
    for (const [k, v] of Object.entries(args ?? {})) {
      const m = props[k];
      if (!m) continue; // unknown key already reported
      const msg = shapeMismatch(m, v);
      if (msg) shapeWarnings.push(`${k}: ${msg}`);
    }
    return { declared: Object.keys(props).length, provided: provided.size, unknownKeys, emptySlots, shapeWarnings, fields };
  }

  /**
   * Validate blocks against component contracts AND build a per-block contract
   * report. `errors` empty = valid; `report` is always returned (even on
   * success) so the caller can self-verify what will render.
   */
  async function checkBlocks(blocks: { id: string; preview?: string; args?: Record<string, unknown> }[]) {
    const provider = getDataProvider();
    const errors: { block: number; id: string; key?: string; message: string }[] = [];
    const report: Array<Record<string, unknown>> = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const comp = await provider.getComponent(b.id.trim());
      if (!comp) {
        errors.push({ block: i, id: b.id, message: 'unknown component id' });
        report.push({ block: i, id: b.id, error: 'unknown component id' });
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (comp as any)?.properties ?? {};
      if (b.args) {
        for (const e of validatePreviewValues(b.args, props)) {
          errors.push({ block: i, id: b.id, key: e.key, message: e.message });
        }
      }
      report.push({ block: i, id: b.id, ...contractReport(props, b.args) });
    }
    return { errors, report };
  }

  const toComponents = (blocks: { id: string; preview?: string; args?: Record<string, unknown> }[]) =>
    blocks.map((b) => ({ id: b.id, ...(b.preview ? { preview: b.preview } : {}), args: b.args ?? {} }));

  server.registerTool(
    'handoff_list_pages',
    {
      description:
        'List playground pages — saved compositions of component blocks ("patterns"). Use to see or ' +
        'reuse existing landing pages before composing a new one. Optionally filter by group.',
      inputSchema: {
        group: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Max pages (default 50).'),
      },
    },
    async ({ group, limit }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      let list = await getDataProvider().getPatterns();
      if (group?.trim()) list = list.filter((p) => (p.group || '').toLowerCase() === group.trim().toLowerCase());
      return textResult(
        list.slice(0, limit ?? 50).map((p) => ({
          id: p.id,
          title: p.title,
          group: p.group,
          blocks: Array.isArray(p.components) ? p.components.length : 0,
        }))
      );
    }
  );

  server.registerTool(
    'handoff_get_page',
    {
      description:
        'Get one playground page (pattern): its ordered block composition ([{id, preview?, args}]) + ' +
        'metadata. Read this before editing/swapping blocks, then pass the modified blocks to handoff_update_page.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const p = await getDataProvider().getPattern(id.trim());
      if (!p) return textResult({ error: 'Not found' });
      return textResult({ id: id.trim(), title: p.title, description: p.description, group: p.group, components: p.components });
    }
  );

  server.registerTool(
    'handoff_scaffold_args',
    {
      description:
        'Get a ready-to-fill `args` template for a component so you dispatch blocks/previews that render ' +
        'WELL instead of guessing prop shapes. Seeds `args` from a real preview (correctly-shaped slots, ' +
        'images, arrays) when one exists, and annotates every field with its editorType + expected shape ' +
        '(richtext = HTML string, image = { src, alt, … }, etc). Fill/tweak the returned `args`, then pass ' +
        'it to handoff_create_page (as a block\'s args) or handoff_create_preview. Call this BEFORE authoring ' +
        'to avoid empty slots / wrong-shaped values.',
      inputSchema: {
        componentId: z.string(),
        fromPreview: z
          .string()
          .optional()
          .describe('Base preview key to seed real values from; defaults to "generic" or the first available.'),
      },
    },
    async ({ componentId, fromPreview }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const comp = await getDataProvider().getComponent(componentId.trim());
      if (!comp) return textResult({ error: 'Not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (comp as any)?.properties ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previews = (comp as any)?.previews ?? {};
      const keys = Object.keys(previews);
      const baseKey =
        fromPreview && keys.includes(fromPreview) ? fromPreview : keys.includes('generic') ? 'generic' : keys[0] ?? null;
      // A preview entry is `{ values, … }`; tolerate a bare values object too.
      const baseValues: Record<string, unknown> = baseKey
        ? (previews[baseKey]?.values ?? previews[baseKey] ?? {})
        : {};
      const args: Record<string, unknown> = {};
      const fields: Record<string, unknown> = {};
      for (const [k, m] of Object.entries(props)) {
        const hasBase = k in baseValues;
        args[k] = hasBase ? baseValues[k] : placeholderValue(m);
        fields[k] = {
          editorType: editorOf(m),
          shape: shapeNote(m),
          fromBase: hasBase,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((m as any)?.options ? { options: (m as any).options } : {}),
        };
      }
      return textResult({
        componentId: componentId.trim(),
        basePreview: baseKey,
        note: baseKey
          ? `args seeded from preview "${baseKey}" (real values) — tweak and dispatch.`
          : 'no base preview available — args are typed placeholders; fill them in.',
        args,
        fields,
      });
    }
  );

  server.registerTool(
    'handoff_create_page',
    {
      description:
        'Compose a NEW playground page (landing page) from component blocks and save it (source: playground). ' +
        'Each block is {id (component id), preview? (existing preview key), args? (prop values)}. To compose ' +
        'blocks that render WELL (not just validly), call handoff_scaffold_args for each component first — it ' +
        'returns correctly-shaped `args` (seeded from a real preview) + per-field shapes; tweak and pass them ' +
        'here. Or reference an existing preview by key via `preview` and override only what changes in `args`. ' +
        'Every block is validated against its contract (unknown ids / out-of-contract args ' +
        'are rejected). Note richtext fields take HTML strings, and any VISUAL slot you leave unset renders ' +
        'blank — the returned `report[].emptySlots` flags those. `editUrl` renders your exact args live now; ' +
        '`publishedUrl` (the standalone page) only reflects this composition after a rebuild.',
      inputSchema: {
        id: z.string().describe('Unique page id / slug.'),
        title: z.string(),
        description: z.string().optional(),
        group: z.string().optional(),
        blocks: z.array(blockSchema).describe('Ordered component blocks composing the page.'),
        message: z.string().optional().describe('Short "why" for this page — shown in the changelog.'),
      },
    },
    async ({ id, title, description, group, blocks, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const { errors, report } = await checkBlocks(blocks);
      if (errors.length) return textResult({ ok: false, errors, report });
      try {
        await writePattern(
          { id, title, description, group, components: toComponents(blocks), source: 'playground' },
          patternActor(message)
        );
      } catch (e) {
        if (isAuthorizationError(e)) return textResult({ ok: false, error: `Forbidden — ${e.message}` });
        throw e;
      }
      const base = issuerForCliSync(request);
      return textResult({
        ok: true,
        id,
        blocks: blocks.length,
        // editUrl renders the exact stored args live (playground client-hydrates
        // each block); publishedUrl is the standalone page, stale until a rebuild.
        editUrl: `${base}/playground?pattern=${encodeURIComponent(id)}`,
        publishedUrl: `${base}/system/pattern/${encodeURIComponent(id)}`,
        publishedNote:
          'publishedUrl reflects this composition only after a rebuild (handoff_enqueue_build). editUrl shows your exact args now.',
        report,
      });
    }
  );

  server.registerTool(
    'handoff_update_page',
    {
      description:
        'Update a playground page: metadata and/or its full block composition. To add/remove/swap/reorder ' +
        'blocks (e.g. swap in a new hero), read the page with handoff_get_page, modify the blocks array, and ' +
        'pass the FULL new array here. Blocks are validated against contracts before saving.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        group: z.string().optional(),
        blocks: z.array(blockSchema).optional().describe('Full replacement block composition (omit to leave unchanged).'),
        message: z.string().optional().describe('Short "why" for this change — shown in the changelog.'),
      },
    },
    async ({ id, title, description, group, blocks, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      let report: Array<Record<string, unknown>> | undefined;
      if (blocks) {
        const checked = await checkBlocks(blocks);
        if (checked.errors.length) return textResult({ ok: false, errors: checked.errors, report: checked.report });
        report = checked.report;
      }
      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (group !== undefined) updates.group = group;
      if (blocks) updates.components = toComponents(blocks);
      if (Object.keys(updates).length === 0) return textResult({ ok: false, error: 'No updates provided.' });
      try {
        await patchPattern(id, updates, patternActor(message));
      } catch (e) {
        if (isAuthorizationError(e)) return textResult({ ok: false, error: `Forbidden — ${e.message}` });
        throw e;
      }
      const base = issuerForCliSync(request);
      return textResult({
        ok: true,
        id,
        ...(blocks ? { blocks: blocks.length } : {}),
        editUrl: `${base}/playground?pattern=${encodeURIComponent(id)}`,
        publishedUrl: `${base}/system/pattern/${encodeURIComponent(id)}`,
        publishedNote:
          'publishedUrl reflects this composition only after a rebuild (handoff_enqueue_build). editUrl shows your exact args now.',
        ...(report ? { report } : {}),
      });
    }
  );

  // ─── Component previews (registry-authored value-sets) — Track 6.1 ────────────

  server.registerTool(
    'handoff_create_preview',
    {
      description:
        'Author a NEW registry preview for a component — a named, semantic value-set (e.g. a "Primary ' +
        'CTA" button). Call handoff_scaffold_args first for correctly-shaped `values`. Values are validated ' +
        'against the component contract; invalid values are rejected, not saved. This is how Claude publishes ' +
        'a configured, meaningful example to the workbench. Richtext ' +
        'fields take HTML strings. Returns `verifyUrl` (renders this value-set in the workbench immediately — ' +
        'no rebuild) and a `report` (empty visual slots + each field\'s editorType) to self-check the values. ' +
        'Once a value-set is approved, mark it canonical with handoff_promote_preview.',
      inputSchema: {
        componentId: z.string(),
        title: z.string().describe('Human label, e.g. "Primary — main page CTA".'),
        values: z.record(z.string(), z.any()).describe('Property values (validated against the contract).'),
        semantic: z.string().optional().describe('Semantic tag (primary/secondary/destructive/…).'),
        rationale: z.string().optional().describe('Why / when to use this preview.'),
        previewKey: z.string().optional().describe('Explicit key; otherwise derived from the title.'),
      },
    },
    async ({ componentId, title, values, semantic, rationale, previewKey }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      try {
        const rec = await createComponentPreview({
          componentId: componentId.trim(),
          title,
          values,
          previewKey,
          semantic: semantic ?? null,
          rationale: rationale ?? null,
          source: 'llm',
          authorId: patternActor().userId,
        });
        // Registry previews render client-side in the workbench immediately (no
        // rebuild) — verifyUrl opens the component surface showing this value-set.
        const base = issuerForCliSync(request);
        const comp = await getDataProvider().getComponent(componentId.trim());
        return textResult({
          ok: true,
          id: rec.id,
          previewKey: rec.previewKey,
          verifyUrl: `${base}/system/component/${encodeURIComponent(componentId.trim())}?preview=${encodeURIComponent(rec.previewKey)}`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          report: contractReport((comp as any)?.properties, values),
        });
      } catch (e) {
        if (e instanceof PreviewValidationFailed) return textResult({ ok: false, errors: e.errors });
        return textResult({ ok: false, error: e instanceof Error ? e.message : 'Failed to create preview' });
      }
    }
  );

  server.registerTool(
    'handoff_update_preview',
    {
      description:
        'Update an existing registry preview (by its id). Provide any of title / values / semantic / ' +
        'rationale. Changed values are re-validated against the component contract. To approve/canonicalize ' +
        'a value-set instead, use handoff_promote_preview.',
      inputSchema: {
        id: z.string().describe('Preview id (from handoff_get_component previews or handoff_create_preview).'),
        title: z.string().optional(),
        values: z.record(z.string(), z.any()).optional(),
        semantic: z.string().optional(),
        rationale: z.string().optional(),
      },
    },
    async ({ id, title, values, semantic, rationale }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      try {
        const rec = await updateComponentPreview(id.trim(), {
          ...(title !== undefined ? { title } : {}),
          ...(values !== undefined ? { values } : {}),
          ...(semantic !== undefined ? { semantic } : {}),
          ...(rationale !== undefined ? { rationale } : {}),
        });
        if (!rec) return textResult({ ok: false, error: 'Not found' });
        const base = issuerForCliSync(request);
        const comp = await getDataProvider().getComponent(rec.componentId);
        return textResult({
          ok: true,
          id: rec.id,
          previewKey: rec.previewKey,
          verifyUrl: `${base}/system/component/${encodeURIComponent(rec.componentId)}?preview=${encodeURIComponent(rec.previewKey)}`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(values !== undefined ? { report: contractReport((comp as any)?.properties, values) } : {}),
        });
      } catch (e) {
        if (e instanceof PreviewValidationFailed) return textResult({ ok: false, errors: e.errors });
        return textResult({ ok: false, error: e instanceof Error ? e.message : 'Failed to update preview' });
      }
    }
  );

  // ─── Loop A: approve / promote a preview (workbench build loop) ───────────────

  server.registerTool(
    'handoff_promote_preview',
    {
      description:
        'Approve a registry preview: mark its value-set canonical (semantic="canonical") so it reads as the ' +
        'blessed, reference example for its component. Use after review to promote a value-set authored via ' +
        'handoff_create_preview / handoff_update_preview. Zero contract change — no rebuild, no migration.',
      inputSchema: {
        id: z.string().describe('Preview id (from handoff_get_component previews or handoff_create_preview).'),
        note: z.string().optional().describe('Optional rationale recorded on the preview.'),
      },
    },
    async ({ id, note }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      try {
        const rec = await updateComponentPreview(id.trim(), {
          semantic: 'canonical',
          ...(note ? { rationale: note } : {}),
        });
        if (!rec) return textResult({ ok: false, error: 'Not found' });
        const base = issuerForCliSync(request);
        return textResult({
          ok: true,
          id: rec.id,
          previewKey: rec.previewKey,
          verifyUrl: `${base}/system/component/${encodeURIComponent(rec.componentId)}?preview=${encodeURIComponent(rec.previewKey)}`,
        });
      } catch (e) {
        if (e instanceof PreviewValidationFailed) return textResult({ ok: false, errors: e.errors });
        return textResult({ ok: false, error: e instanceof Error ? e.message : 'Failed to promote preview' });
      }
    }
  );

  // ─── Doc pages (markdown documentation) — Track 6.1 / goal 2 ──────────────────

  const cleanSlug = (s: string) => s.trim().replace(/^\/+|\/+$/g, '');

  server.registerTool(
    'handoff_list_doc_pages',
    {
      description:
        'List markdown documentation pages (slug, title, description). These are doc/content pages — ' +
        'distinct from playground pages (block compositions; use handoff_list_pages for those).',
      inputSchema: {},
    },
    async () => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      return textResult(await listHandoffPages());
    }
  );

  server.registerTool(
    'handoff_get_doc_page',
    {
      description: 'Get one markdown doc page by slug — its frontmatter + markdown body.',
      inputSchema: { slug: z.string().describe('Page slug, e.g. "guides/getting-started".') },
    },
    async ({ slug }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const p = await getHandoffPageBySlug(cleanSlug(slug));
      if (!p) return textResult({ error: 'Not found' });
      return textResult(p);
    }
  );

  server.registerTool(
    'handoff_create_doc_page',
    {
      description:
        'Create a NEW markdown doc page. Fails if the slug already exists (use handoff_update_doc_page). ' +
        'The page appears in the sidebar nav automatically.',
      inputSchema: {
        slug: z.string().describe('Path under pages/ without extension, e.g. "guides/getting-started".'),
        title: z.string(),
        markdown: z.string().describe('Markdown body.'),
        frontmatter: z.record(z.string(), z.any()).optional().describe('Extra frontmatter (weight, menu, …).'),
        message: z.string().optional().describe('Short "why" — shown in the changelog.'),
      },
    },
    async ({ slug, title, markdown, frontmatter, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const s = cleanSlug(slug);
      if (await getHandoffPageBySlug(s)) {
        return textResult({ ok: false, error: `Page "${s}" already exists — use handoff_update_doc_page.` });
      }
      const { page, action } = await writeDocPage(
        { slug: s, frontmatter: { ...(frontmatter ?? {}), title }, markdown },
        docPageActor(message)
      );
      return textResult({ ok: true, slug: page.slug, action });
    }
  );

  server.registerTool(
    'handoff_update_doc_page',
    {
      description:
        'Update an existing markdown doc page (by slug). Fails if it does not exist. Provide markdown ' +
        'and/or title/frontmatter; frontmatter is merged with the existing.',
      inputSchema: {
        slug: z.string(),
        title: z.string().optional(),
        markdown: z.string().optional(),
        frontmatter: z.record(z.string(), z.any()).optional(),
        message: z.string().optional().describe('Short "why" — shown in the changelog.'),
      },
    },
    async ({ slug, title, markdown, frontmatter, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const s = cleanSlug(slug);
      const existing = await getHandoffPageBySlug(s);
      if (!existing) {
        return textResult({ ok: false, error: `Page "${s}" not found — use handoff_create_doc_page.` });
      }
      const mergedFm = {
        ...existing.frontmatter,
        ...(frontmatter ?? {}),
        ...(title !== undefined ? { title } : {}),
      };
      const { page, action } = await writeDocPage(
        { slug: s, frontmatter: mergedFm, markdown: markdown ?? existing.markdown },
        docPageActor(message)
      );
      return textResult({ ok: true, slug: page.slug, action });
    }
  );

  server.registerTool(
    'handoff_delete_doc_page',
    {
      description:
        'Delete a markdown doc page by slug. Removes it from the sidebar nav and records the deletion ' +
        'in the changelog. Fails if the slug does not exist.',
      inputSchema: {
        slug: z.string(),
        message: z.string().optional().describe('Short "why" — shown in the changelog.'),
      },
    },
    async ({ slug, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const result = await deleteDocPage(cleanSlug(slug), docPageActor(message));
      return textResult(result);
    }
  );

  server.registerTool(
    'handoff_move_doc_page',
    {
      description:
        'Move (rename) a markdown doc page from one slug to another, preserving its content. Fails if ' +
        'fromSlug does not exist or toSlug is already taken. Use this instead of delete+create so the ' +
        'page keeps its history and the nav tree updates atomically.',
      inputSchema: {
        fromSlug: z.string(),
        toSlug: z.string(),
        message: z.string().optional().describe('Short "why" — shown in the changelog.'),
      },
    },
    async ({ fromSlug, toSlug, message }) => {
      if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
      const denied = requireScope(auth, 'sync:write');
      if (denied) return denied;
      const result = await moveDocPage(cleanSlug(fromSlug), cleanSlug(toSlug), docPageActor(message));
      if (!result.ok) return textResult(result);
      return textResult({ ok: true, slug: result.page.slug });
    }
  );

  // ─── Embedded preview app (MCP Apps, Track 6.2) ───────────────────────────────
  // A ui:// HTML resource (rendered in the host's sandboxed iframe) that shows a
  // component's real preview via an inner iframe → the registry's §14 preview HTML.
  {
    const origin = (() => {
      try {
        return new URL(request.url).origin;
      } catch {
        return '';
      }
    })();
    const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
    const registryBase = `${origin}${basePath}`;
    const PREVIEW_UI_URI = 'ui://handoff/component-preview';
    const appJs = Buffer.from(COMPONENT_PREVIEW_APP_JS_B64, 'base64').toString('utf8');

    // Inline probe: minimal shell. The app builds its own DOM into #root and
    // renders everything inline (no nested iframe), so this shell just carries
    // the module. Body starts with a plain "Loading…" so that if the sandbox
    // renders the resource but the script never runs, that's still visible.
    const previewAppHtml = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>:root{color-scheme:light dark}html,body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif}</style></head>
<body>
  <div id="root">Loading…</div>
  <script type="module">${appJs}</script>
</body></html>`;

    // CSP for the sandbox. The app renders inline (no nested iframe), so no
    // frame-src is needed — only `resourceDomains` (→ CSP img-src) so a
    // cross-origin <img> from the registry can load, plus `connectDomains`
    // (→ connect-src) for any app fetches.
    //
    // CRITICAL: the host reads this CSP from the `_meta.ui` on the RESOURCE (the
    // `resources/list` descriptor — the config arg below) to build the sandbox
    // policy. A `_meta.ui` on the resources/read content item only "takes
    // precedence" if the host already picked the resource up from the list — so it
    // must live on the descriptor. We set it on BOTH (descriptor + content item).
    const previewUiMeta = origin
      ? { ui: { csp: { resourceDomains: [origin], connectDomains: [origin] } } }
      : {};

    registerAppResource(
      server,
      'Component preview',
      PREVIEW_UI_URI,
      { description: 'Interactive component preview renderer.', _meta: previewUiMeta },
      async () => ({
        contents: [
          {
            uri: PREVIEW_UI_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: previewAppHtml,
            _meta: previewUiMeta,
          },
        ],
      })
    );

    registerAppTool(
      server,
      'handoff_preview_component',
      {
        description:
          'Render an INTERACTIVE, inline preview of a component (embedded app) — the real rendered ' +
          'component with responsive width controls. Pass a component id and optionally a preview key. ' +
          'Use when the user wants to SEE a component, not just read its data (handoff_get_component).',
        inputSchema: {
          id: z.string(),
          preview: z.string().optional().describe('Preview/variant key; defaults to "generic" or the first available.'),
        },
        _meta: { ui: { resourceUri: PREVIEW_UI_URI } },
      },
      async ({ id, preview }) => {
        if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
        const comp = await getDataProvider().getComponent(id.trim());
        if (!comp) return textResult({ error: 'Not found' });
        const previews = ((comp as { previews?: Record<string, unknown> }).previews) ?? {};
        const keys = Object.keys(previews);
        const requestedIsBuilt = preview ? keys.includes(preview) : false;

        // A registry-authored (DB) preview has NO static <id>-<key>.html — the
        // inline app can only render BUILT previews. If the caller asks for a key
        // that isn't built, don't silently fall back to "generic" (that renders
        // the wrong thing): if it's a DB preview, surface a verifyUrl to the
        // workbench (which client-renders it) instead.
        let dbVerifyUrl: string | undefined;
        let dbNote: string | undefined;
        if (preview && !requestedIsBuilt) {
          const dbMatch = (await listComponentPreviews(id.trim())).find((p) => p.previewKey === preview);
          if (dbMatch) {
            dbVerifyUrl = `${registryBase}/system/component/${encodeURIComponent(id.trim())}?preview=${encodeURIComponent(preview)}`;
            dbNote = `"${preview}" is a registry-authored preview with no inline static render — open verifyUrl to see it in the workbench.`;
          }
        }

        const previewKey = requestedIsBuilt ? preview! : keys.includes('generic') ? 'generic' : keys[0];
        const previewUrl = previewKey
          ? `${registryBase}/api/component/${encodeURIComponent(id.trim())}/${encodeURIComponent(`${id.trim()}-${previewKey}`)}.html`
          : null;
        const data = {
          componentId: id.trim(),
          previewKey: previewKey ?? null,
          previewUrl,
          ...(dbVerifyUrl ? { verifyUrl: dbVerifyUrl } : {}),
          ...(dbNote ? { note: dbNote } : {}),
          // Cross-origin image for the inline app to render (img-src probe). The
          // registry logo is guaranteed to exist; swap for a real component
          // thumbnail/screenshot endpoint once the inline path is proven.
          imageUrl: `${registryBase}/api/registry/logo.svg`,
          title: (comp as { title?: string }).title ?? id.trim(),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
      }
    );

    // ─── Token / palette picker app ─────────────────────────────────────────────
    // Pure-inline app (colors/type/spacing are CSS — no images, no network, no
    // frame), so no CSP domains are needed. Clicking a token pushes it back to the
    // model via the app→host bridge (updateModelContext).
    const PALETTE_UI_URI = 'ui://handoff/token-palette';
    const paletteJs = Buffer.from(TOKEN_PALETTE_APP_JS_B64, 'base64').toString('utf8');
    const paletteHtml = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>:root{color-scheme:light dark}html,body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif}</style></head>
<body>
  <div id="root">Loading…</div>
  <script type="module">${paletteJs}</script>
</body></html>`;

    registerAppResource(
      server,
      'Token palette',
      PALETTE_UI_URI,
      { description: 'Interactive design-token palette (colors, type, spacing).', _meta: { ui: {} } },
      async () => ({
        contents: [{ uri: PALETTE_UI_URI, mimeType: RESOURCE_MIME_TYPE, text: paletteHtml, _meta: { ui: {} } }],
      })
    );

    registerAppTool(
      server,
      'handoff_browse_tokens',
      {
        description:
          'Open an INTERACTIVE inline palette of the design system\'s foundation tokens (color swatches, ' +
          'type specimens, spacing scale). The user can click a token to hand it back to you. Use when the ' +
          'user wants to SEE and pick tokens; use handoff_get_tokens for raw token data.',
        inputSchema: {
          brand: z.string().optional().describe('Brand axis value to resolve tokens for (multi-axis systems).'),
          scheme: z.string().optional().describe('Scheme axis value, e.g. "light"/"dark" (multi-axis systems).'),
        },
        _meta: { ui: { resourceUri: PALETTE_UI_URI } },
      },
      async ({ brand, scheme }) => {
        if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
        const selector: Record<string, string> = {};
        if (brand) selector.brand = brand;
        if (scheme) selector.scheme = scheme;
        const tokens = await collectFoundationTokens(getDataProvider(), [], selector);
        const data = {
          colors: tokens.colors ?? [],
          typography: tokens.typography ?? [],
          spacing: tokens.spacing ?? [],
          borderRadius: tokens.borderRadius ?? [],
        };
        const summary = `Palette: ${(data.colors as unknown[]).length} colors, ${(data.typography as unknown[]).length} type styles, ${(data.spacing as unknown[]).length} spacing steps.`;
        return { content: [{ type: 'text' as const, text: summary }], structuredContent: data };
      }
    );

    // ─── Component gallery / picker app ─────────────────────────────────────────
    // Inline metadata card grid (no thumbnails yet — no prod-viable component-image
    // source; cards carry an optional imageUrl for later). Click → select (pushes
    // the choice back via updateModelContext); "Open ↗" → openLink to the live
    // component detail page. Both degrade gracefully in the app.
    const GALLERY_UI_URI = 'ui://handoff/component-gallery';
    const galleryJs = Buffer.from(COMPONENT_GALLERY_APP_JS_B64, 'base64').toString('utf8');
    const galleryHtml = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>:root{color-scheme:light dark}html,body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif}</style></head>
<body>
  <div id="root">Loading…</div>
  <script type="module">${galleryJs}</script>
</body></html>`;

    registerAppResource(
      server,
      'Component gallery',
      GALLERY_UI_URI,
      { description: 'Interactive component catalog — search, select, and open components.', _meta: { ui: {} } },
      async () => ({
        contents: [{ uri: GALLERY_UI_URI, mimeType: RESOURCE_MIME_TYPE, text: galleryHtml, _meta: { ui: {} } }],
      })
    );

    registerAppTool(
      server,
      'handoff_browse_components',
      {
        description:
          'Open an INTERACTIVE inline gallery of the design system\'s components — a searchable card grid. ' +
          'The user can Select a component to hand it back to you, or Open it in Handoff. Use when the user ' +
          'wants to browse or pick a component; use handoff_search_components for raw catalog data.',
        inputSchema: {
          query: z.string().optional().describe('Optional initial substring filter (id/title/group/tag).'),
          group: z.string().optional().describe('Optional group filter.'),
        },
        _meta: { ui: { resourceUri: GALLERY_UI_URI } },
      },
      async ({ query, group }) => {
        if (!usePostgres()) return textResult(WORKSPACE_MODE_RESPONSE);
        let list = await getDataProvider().getComponents();
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
        if (group?.trim()) list = list.filter((c) => (c.group || '').toLowerCase() === group.trim().toLowerCase());
        const components = list.map((c) => ({
          id: c.id,
          title: c.title,
          group: c.group,
          type: c.type,
          tags: Array.isArray(c.tags) ? c.tags.slice(0, 6) : [],
          detailUrl: `${registryBase}/system/component/${encodeURIComponent(c.id)}`,
        }));
        const data = { components };
        return { content: [{ type: 'text' as const, text: `Gallery: ${components.length} components.` }], structuredContent: data };
      }
    );
  }

  return server;
}
