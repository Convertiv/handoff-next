import 'server-only';

import {
  DESIGN_WORKSPACE_ID,
  getDesignWorkspaceRow,
  upsertDesignWorkspaceRow,
  type DesignWorkspacePatch,
  type DesignWorkspaceRow,
} from '@/lib/db/queries';
import { formatBrandVoiceForPrompt, isWorkspaceEmpty, type BrandVoiceMap } from '@/lib/design-workspace-format';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';
export type DesignWorkspaceDto = {
  id: string;
  designMd: string;
  brandVoice: BrandVoiceMap;
  includeFoundations: boolean;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl: string; updatedAt?: string }>;
  updatedAt: string | null;
};

const MAX_IMAGE_DATA_URL_CHARS = 800_000;

function rowToDto(row: DesignWorkspaceRow | null): DesignWorkspaceDto {
  if (!row) {
    return {
      id: DESIGN_WORKSPACE_ID,
      designMd: '',
      brandVoice: {},
      includeFoundations: true,
      customFoundationImageUrl: '',
      componentReferences: {},
      updatedAt: null,
    };
  }
  return {
    id: row.id,
    designMd: row.designMd ?? '',
    brandVoice: (row.brandVoice as BrandVoiceMap) ?? {},
    includeFoundations: row.includeFoundations ?? true,
    customFoundationImageUrl: row.customFoundationImageUrl ?? '',
    componentReferences:
      (row.componentReferences as Record<string, { imageUrl: string; updatedAt?: string }>) ?? {},
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

function capImageDataUrl(url: string): string {
  if (!url.startsWith('data:image/')) return url;
  if (url.length <= MAX_IMAGE_DATA_URL_CHARS) return url;
  return `${url.slice(0, MAX_IMAGE_DATA_URL_CHARS)}…[truncated]`;
}

function sanitizeComponentReferences(
  refs: Record<string, { imageUrl: string; updatedAt?: string }>
): Record<string, { imageUrl: string; updatedAt?: string }> {
  const out: Record<string, { imageUrl: string; updatedAt?: string }> = {};
  for (const [slot, ref] of Object.entries(refs)) {
    if (!ref?.imageUrl?.trim()) continue;
    out[slot] = {
      imageUrl: capImageDataUrl(ref.imageUrl.trim()),
      updatedAt: ref.updatedAt ?? new Date().toISOString(),
    };
  }
  return out;
}

export async function getDesignWorkspace(): Promise<DesignWorkspaceDto> {
  const row = await getDesignWorkspaceRow();
  return rowToDto(row);
}

export async function upsertDesignWorkspace(
  patch: DesignWorkspacePatch,
  actorUserId: string | null
): Promise<DesignWorkspaceDto> {
  const sanitized: DesignWorkspacePatch = { ...patch };
  if (patch.customFoundationImageUrl !== undefined) {
    sanitized.customFoundationImageUrl = capImageDataUrl(patch.customFoundationImageUrl);
  }
  if (patch.componentReferences !== undefined) {
    sanitized.componentReferences = sanitizeComponentReferences(patch.componentReferences);
  }
  const row = await upsertDesignWorkspaceRow(sanitized, actorUserId);
  return rowToDto(row);
}

export { formatBrandVoiceForPrompt, isWorkspaceEmpty };

export function formatDesignWorkspaceForMcp(workspace: DesignWorkspaceDto): {
  designMdPreview: string;
  brandVoice: BrandVoiceMap;
  componentReferenceSlots: string[];
  hasDesignGuidelines: boolean;
  hasBrandVoice: boolean;
} {
  const slots = COMPONENT_REFERENCE_SETTINGS.map((s) => s.id).filter(
    (id) => workspace.componentReferences[id]?.imageUrl?.trim()
  );
  return {
    designMdPreview: workspace.designMd.slice(0, 500),
    brandVoice: workspace.brandVoice,
    componentReferenceSlots: slots,
    hasDesignGuidelines: Boolean(workspace.designMd.trim()),
    hasBrandVoice: Object.values(workspace.brandVoice).some((v) => v?.trim()),
  };
}

/** Markdown block for component-generation and similar text LLMs. */
export async function loadDesignWorkspaceMarkdown(maxChars = 8000): Promise<string> {
  const ws = await getDesignWorkspace();
  if (isWorkspaceEmpty(ws)) return '';

  const parts: string[] = [];
  if (ws.designMd.trim()) {
    parts.push(`## Design guidelines (team workspace)\n\n${ws.designMd.trim()}`);
  }
  const brand = formatBrandVoiceForPrompt(ws.brandVoice);
  if (brand.trim()) {
    parts.push(`## Brand voice (team workspace)\n\n${brand}`);
  }
  const refLabels = COMPONENT_REFERENCE_SETTINGS.filter((s) => ws.componentReferences[s.id]?.imageUrl?.trim()).map(
    (s) => s.label
  );
  if (refLabels.length > 0) {
    parts.push(
      `## Component reference images (team workspace)\n\nSlots configured: ${refLabels.join(', ')}. Use Handoff MCP \`handoff_get_component_reference\` for image data.`
    );
  }

  const joined = parts.join('\n\n');
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}\n\n…[truncated]`;
}

/** Merge request overrides with team workspace defaults for image generation. */
export async function resolveDesignGenerationContext(opts: {
  designGuidelines?: string;
  brandVoiceGuidelines?: string;
  componentReferenceFiles?: { slot: string; dataUrl: string }[];
  customFoundationFromRequest?: boolean;
}): Promise<{
  designGuidelines: string;
  brandVoiceGuidelines: string;
  componentReferenceFiles: { slot: string; dataUrl: string; filename: string }[];
  customFoundationImageUrl: string;
  includeFoundationsDefault: boolean;
}> {
  const ws = await getDesignWorkspace();
  const designGuidelines = opts.designGuidelines?.trim() || ws.designMd.trim();
  const brandVoiceGuidelines = opts.brandVoiceGuidelines?.trim() || formatBrandVoiceForPrompt(ws.brandVoice);

  const files: { slot: string; dataUrl: string; filename: string }[] = [];
  if (opts.componentReferenceFiles?.length) {
    for (const f of opts.componentReferenceFiles) {
      const setting = COMPONENT_REFERENCE_SETTINGS.find((s) => s.id === f.slot);
      if (setting && f.dataUrl?.trim()) {
        files.push({ slot: f.slot, dataUrl: f.dataUrl, filename: setting.filename });
      }
    }
  } else {
    for (const setting of COMPONENT_REFERENCE_SETTINGS) {
      const url = ws.componentReferences[setting.id]?.imageUrl?.trim();
      if (url) files.push({ slot: setting.id, dataUrl: url, filename: setting.filename });
    }
  }

  return {
    designGuidelines,
    brandVoiceGuidelines,
    componentReferenceFiles: files,
    customFoundationImageUrl: ws.customFoundationImageUrl,
    includeFoundationsDefault: ws.includeFoundations,
  };
}
