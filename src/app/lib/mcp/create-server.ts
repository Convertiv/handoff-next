import 'server-only';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { buildProjectContext, resolveStackProfile } from '@/lib/mcp/project-profile';
import { loadStackGuideMarkdown } from '@/lib/mcp/stack-guides';
import { getReferenceMaterialById, listReferenceMaterials } from '@/lib/db/queries';
import { isReferenceMaterialId, REFERENCE_MATERIAL_IDS } from '@/lib/server/reference-material-ids';
import { getDataProvider } from '@/lib/data';
import { fetchSyncChangesSince } from '@/lib/db/sync-queries';
import type { SyncUploadBody } from '@handoff/types/handoff-sync';
import { applyUploadedChange } from '@/lib/db/sync-queries';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { jwtScopesInclude } from '@/lib/cli-sync-jwt';
import {
  formatBrandVoiceForPrompt,
  formatDesignWorkspaceForMcp,
  getDesignWorkspace,
} from '@/lib/server/design-workspace';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';

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
      description: 'Fetch generated reference material: catalog | tokens | icons | property-patterns.',
      inputSchema: { id: z.enum(['catalog', 'tokens', 'icons', 'property-patterns']) },
    },
    async ({ id }) => {
      if (!isReferenceMaterialId(id)) return textResult({ error: 'Invalid reference id' });
      const row = await getReferenceMaterialById(id);
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
      description: 'Full component row by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const provider = getDataProvider();
      const row = await provider.getComponent(id.trim());
      if (!row) return textResult({ error: 'Not found' });
      return textResult(row);
    }
  );

  server.registerTool(
    'handoff_get_tokens',
    {
      description: 'Design tokens snapshot for the deployment.',
      inputSchema: {},
    },
    async () => {
      const provider = getDataProvider();
      const tokens = await provider.getTokens();
      return textResult(tokens);
    }
  );

  server.registerTool(
    'handoff_sync_status',
    { description: 'Remote sync cursor and health.', inputSchema: {} },
    async () => {
      const { getSyncStatus } = await import('@/lib/db/sync-queries');
      return textResult(await getSyncStatus());
    }
  );

  server.registerTool(
    'handoff_sync_pull',
    {
      description: 'Fetch sync changes since cursor (JSON patches for local apply).',
      inputSchema: { since: z.number().int().min(0).optional() },
    },
    async ({ since }) => {
      const changeset = await fetchSyncChangesSince(since ?? 0);
      return textResult(changeset);
    }
  );

  server.registerTool(
    'handoff_sync_push',
    {
      description: 'Upload sync changes (requires sync:write).',
      inputSchema: { body: z.custom<SyncUploadBody>() },
    },
    async ({ body }) => {
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
      description: 'List saved design library artifacts.',
      inputSchema: { status: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ status, limit }) => {
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
    'handoff_start_component_from_design',
    {
      description: 'Enqueue design → component generation job.',
      inputSchema: {
        artifactId: z.string(),
        componentName: z.string(),
        renderer: z.enum(['handlebars', 'react', 'csf']).optional(),
        behaviorPrompt: z.string().optional(),
        a11yStandard: z.enum(['none', 'wcag-aa', 'wcag-aaa']).optional(),
        useExtractedAssets: z.boolean().optional(),
        maxIterations: z.number().int().min(1).max(10).optional(),
      },
    },
    async (args) => {
      const { getDesignArtifactById, insertComponentGenerationJob } = await import('@/lib/db/queries');
      const { scheduleComponentGenerationJob } = await import('@/lib/server/component-generation-schedule');
      const { isValidComponentId } = await import('@/lib/component-id');
      const componentId = args.componentName.trim().toLowerCase();
      if (!isValidComponentId(componentId)) return textResult({ error: 'Invalid componentName' });
      const artifact = await getDesignArtifactById(args.artifactId.trim());
      if (!artifact) return textResult({ error: 'Design not found' });
      const jobId = await insertComponentGenerationJob({
        artifactId: artifact.id,
        userId: auth.userId,
        componentId,
        renderer: args.renderer ?? 'handlebars',
        behaviorPrompt: args.behaviorPrompt ?? '',
        a11yStandard: args.a11yStandard ?? 'none',
        useExtractedAssets: args.useExtractedAssets ?? true,
        maxIterations: args.maxIterations ?? 3,
      });
      scheduleComponentGenerationJob(jobId);
      return textResult({ jobId, status: 'queued' });
    }
  );

  server.registerTool(
    'handoff_get_generation_job',
    {
      description: 'Poll component generation job status.',
      inputSchema: { jobId: z.number().int() },
    },
    async ({ jobId }) => {
      const { getComponentGenerationJob } = await import('@/lib/db/queries');
      const job = await getComponentGenerationJob(jobId);
      if (!job) return textResult({ error: 'Not found' });
      return textResult(job);
    }
  );

  server.registerTool(
    'handoff_enqueue_build',
    {
      description: 'Queue Vite preview build for a component (admin).',
      inputSchema: { componentId: z.string() },
    },
    async ({ componentId }) => {
      if (auth.role !== 'admin' && !auth.isLegacySecret) return textResult({ error: 'Admin required' });
      const { insertBuildJob, spawnComponentBuildWorker } = await import('@/lib/server/component-builder');
      const jobId = await insertBuildJob(componentId.trim());
      spawnComponentBuildWorker(jobId);
      return textResult({ jobId, status: 'queued' });
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

  return server;
}
