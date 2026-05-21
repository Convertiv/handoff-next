import { handoffApiUrl } from '@/lib/api-path';
import {
  BRAND_VOICE_SETTINGS,
  COMPONENT_REFERENCE_SETTINGS,
  CUSTOM_FOUNDATION_IMAGE_SETTING_KEY,
  DESIGN_MD_SETTING_KEY,
  INCLUDE_FOUNDATIONS_SETTING_KEY,
} from '@/app/design/settings/settings-constants';
import { isWorkspaceEmpty } from '@/lib/design-workspace-format';

export type DesignWorkspaceClientDto = {
  id: string;
  designMd: string;
  brandVoice: Record<string, string>;
  includeFoundations: boolean;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl: string; updatedAt?: string }>;
  updatedAt: string | null;
};

export async function fetchDesignWorkspace(): Promise<DesignWorkspaceClientDto | null> {
  try {
    const res = await fetch(handoffApiUrl('/api/handoff/design/workspace'), { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as { workspace?: DesignWorkspaceClientDto };
    return json.workspace ?? null;
  } catch {
    return null;
  }
}

export function applyWorkspaceToState(ws: DesignWorkspaceClientDto): {
  includeFoundations: boolean;
  customFoundationImageUrl: string;
  componentReferences: Record<string, string>;
  designMd: string;
  brandVoice: Record<string, string>;
} {
  const componentReferences: Record<string, string> = {};
  for (const setting of COMPONENT_REFERENCE_SETTINGS) {
    componentReferences[setting.id] = ws.componentReferences[setting.id]?.imageUrl ?? '';
  }
  return {
    includeFoundations: ws.includeFoundations,
    customFoundationImageUrl: ws.customFoundationImageUrl,
    componentReferences,
    designMd: ws.designMd,
    brandVoice: ws.brandVoice,
  };
}

export function readLocalStorageWorkspace(): {
  designMd: string;
  brandVoice: Record<string, string>;
  includeFoundations: boolean;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl: string }>;
} {
  try {
    const brandVoice = Object.fromEntries(
      BRAND_VOICE_SETTINGS.map((s) => [s.id, window.localStorage.getItem(s.storageKey) || ''])
    );
    const componentReferences: Record<string, { imageUrl: string }> = {};
    for (const setting of COMPONENT_REFERENCE_SETTINGS) {
      const url = window.localStorage.getItem(setting.storageKey) || '';
      if (url) componentReferences[setting.id] = { imageUrl: url };
    }
    return {
      designMd: window.localStorage.getItem(DESIGN_MD_SETTING_KEY) || '',
      brandVoice,
      includeFoundations: window.localStorage.getItem(INCLUDE_FOUNDATIONS_SETTING_KEY) !== 'false',
      customFoundationImageUrl: window.localStorage.getItem(CUSTOM_FOUNDATION_IMAGE_SETTING_KEY) || '',
      componentReferences,
    };
  } catch {
    return {
      designMd: '',
      brandVoice: {},
      includeFoundations: true,
      customFoundationImageUrl: '',
      componentReferences: {},
    };
  }
}

export function clearLocalStorageWorkspace(): void {
  try {
    window.localStorage.removeItem(DESIGN_MD_SETTING_KEY);
    window.localStorage.removeItem(INCLUDE_FOUNDATIONS_SETTING_KEY);
    window.localStorage.removeItem(CUSTOM_FOUNDATION_IMAGE_SETTING_KEY);
    for (const s of BRAND_VOICE_SETTINGS) window.localStorage.removeItem(s.storageKey);
    for (const s of COMPONENT_REFERENCE_SETTINGS) window.localStorage.removeItem(s.storageKey);
  } catch {
    // ignore
  }
}

export async function migrateLocalStorageToWorkspace(): Promise<boolean> {
  const local = readLocalStorageWorkspace();
  if (
    isWorkspaceEmpty({
      designMd: local.designMd,
      brandVoice: local.brandVoice,
      customFoundationImageUrl: local.customFoundationImageUrl,
      componentReferences: local.componentReferences,
    })
  ) {
    return false;
  }
  const res = await fetch(handoffApiUrl('/api/handoff/design/workspace'), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      designMd: local.designMd,
      brandVoice: local.brandVoice,
      includeFoundations: local.includeFoundations,
      customFoundationImageUrl: local.customFoundationImageUrl || null,
      componentReferences: local.componentReferences,
    }),
  });
  if (res.ok) {
    clearLocalStorageWorkspace();
    return true;
  }
  return false;
}

export async function saveDesignWorkspace(body: {
  designMd: string;
  brandVoice: Record<string, string>;
  includeFoundations: boolean;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl: string; updatedAt?: string }>;
}): Promise<{ ok: boolean; workspace?: DesignWorkspaceClientDto; error?: string }> {
  const res = await fetch(handoffApiUrl('/api/handoff/design/workspace'), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      designMd: body.designMd,
      brandVoice: body.brandVoice,
      includeFoundations: body.includeFoundations,
      customFoundationImageUrl: body.customFoundationImageUrl || null,
      componentReferences: Object.fromEntries(
        Object.entries(body.componentReferences).filter(([, v]) => v?.imageUrl?.trim())
      ),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { workspace?: DesignWorkspaceClientDto; error?: string };
  if (!res.ok) return { ok: false, error: json.error || `Save failed (${res.status})` };
  return { ok: true, workspace: json.workspace };
}
