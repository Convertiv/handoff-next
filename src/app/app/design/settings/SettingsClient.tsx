'use client';

import type { ClientConfig } from '@handoff/types/config';
import { ArrowLeftIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Layout from '@/components/Layout/Main';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Metadata, SectionLink } from '@/components/util';
import {
  applyWorkspaceToState,
  fetchDesignWorkspace,
  migrateLocalStorageToWorkspace,
  saveDesignWorkspace,
} from '@/lib/design-workspace-client';
import { isWorkspaceEmpty } from '@/lib/design-workspace-format';
import type { DesignWorkbenchFoundationContext } from '../workbench-types';
import { BRAND_VOICE_SETTINGS, COMPONENT_REFERENCE_SETTINGS } from './settings-constants';

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
  metadata: Metadata;
  foundations: DesignWorkbenchFoundationContext;
  canEdit: boolean;
};

function countFoundations(foundations: DesignWorkbenchFoundationContext): number {
  return foundations.colors.length + foundations.typography.length + foundations.effects.length + foundations.spacing.length;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export default function DesignSettingsClient({ config, menu, metadata, foundations, canEdit }: Props) {
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [includeFoundations, setIncludeFoundations] = useState(true);
  const [customFoundationImage, setCustomFoundationImage] = useState('');
  const [componentReferences, setComponentReferences] = useState<Record<string, string>>({});
  const [designMd, setDesignMd] = useState('');
  const [brandVoice, setBrandVoice] = useState<Record<string, string>>({});

  const applyState = useCallback((state: ReturnType<typeof applyWorkspaceToState>) => {
    setIncludeFoundations(state.includeFoundations);
    setCustomFoundationImage(state.customFoundationImageUrl);
    setComponentReferences(state.componentReferences);
    setDesignMd(state.designMd);
    setBrandVoice(state.brandVoice);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const ws = await fetchDesignWorkspace();
      if (cancelled) return;
      if (ws) {
        if (
          canEdit &&
          isWorkspaceEmpty({
            designMd: ws.designMd,
            brandVoice: ws.brandVoice,
            customFoundationImageUrl: ws.customFoundationImageUrl,
            componentReferences: ws.componentReferences,
          })
        ) {
          const migrated = await migrateLocalStorageToWorkspace();
          if (migrated && !cancelled) {
            const refreshed = await fetchDesignWorkspace();
            if (refreshed) {
              applyState(applyWorkspaceToState(refreshed));
              setSaveMessage('Settings migrated from this browser to the team workspace.');
            }
          } else {
            applyState(applyWorkspaceToState(ws));
          }
        } else {
          applyState(applyWorkspaceToState(ws));
        }
      } else {
        setLoadError('Team workspace is unavailable (hosted Postgres required). Changes stay in this browser only.');
        const { readLocalStorageWorkspace } = await import('@/lib/design-workspace-client');
        const local = readLocalStorageWorkspace();
        applyState({
          includeFoundations: local.includeFoundations,
          customFoundationImageUrl: local.customFoundationImageUrl,
          componentReferences: Object.fromEntries(
            Object.entries(local.componentReferences).map(([k, v]) => [k, v.imageUrl])
          ),
          designMd: local.designMd,
          brandVoice: local.brandVoice,
        });
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, applyState]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setSaveMessage(null);
    const refs: Record<string, { imageUrl: string }> = {};
    for (const setting of COMPONENT_REFERENCE_SETTINGS) {
      const url = componentReferences[setting.id]?.trim();
      if (url) refs[setting.id] = { imageUrl: url };
    }
    const result = await saveDesignWorkspace({
      designMd,
      brandVoice,
      includeFoundations,
      customFoundationImageUrl: customFoundationImage,
      componentReferences: refs,
    });
    setSaving(false);
    if (result.ok) {
      setSaveMessage('Saved to team workspace.');
      if (result.workspace) applyState(applyWorkspaceToState(result.workspace));
    } else {
      setSaveMessage(result.error ?? 'Save failed');
    }
  };

  const updateIncludeFoundations = (checked: boolean) => {
    if (!canEdit) return;
    setIncludeFoundations(checked);
  };

  const updateCustomFoundationImage = async (file: File | undefined) => {
    if (!canEdit || !file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    setCustomFoundationImage(await fileToDataUrl(file));
  };

  const removeCustomFoundationImage = () => {
    if (!canEdit) return;
    setCustomFoundationImage('');
  };

  const updateComponentReference = async (setting: (typeof COMPONENT_REFERENCE_SETTINGS)[number], file: File | undefined) => {
    if (!canEdit || !file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    const dataUrl = await fileToDataUrl(file);
    setComponentReferences((current) => ({ ...current, [setting.id]: dataUrl }));
  };

  const removeComponentReference = (setting: (typeof COMPONENT_REFERENCE_SETTINGS)[number]) => {
    if (!canEdit) return;
    setComponentReferences((current) => ({ ...current, [setting.id]: '' }));
  };

  const updateDesignMd = (value: string) => {
    if (!canEdit) return;
    setDesignMd(value);
  };

  const updateBrandVoice = (setting: (typeof BRAND_VOICE_SETTINGS)[number], value: string) => {
    if (!canEdit) return;
    setBrandVoice((current) => ({ ...current, [setting.id]: value }));
  };

  const foundationCount = countFoundations(foundations);

  return (
    <Layout
      config={config}
      menu={menu}
      current={null}
      metadata={{ metaTitle: metadata.metaTitle, metaDescription: metadata.metaDescription }}
    >
      <div className="flex max-w-4xl flex-col gap-6 pb-10">
        <div className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Design settings</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Team-wide context for the design workbench and Handoff MCP (Design.MD, brand voice, component references).
              {canEdit ? ' Admins can edit and save.' : ' View only — ask an admin to update.'}
            </p>
            {loadError ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{loadError}</p> : null}
            {saveMessage ? <p className="mt-2 text-sm text-muted-foreground">{saveMessage}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="button" size="sm" disabled={loading || saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save team settings'}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link href={`${basePath}/design/`}>
                <ArrowLeftIcon className="mr-1.5 h-3.5 w-3.5" />
                Workbench
              </Link>
            </Button>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted-foreground">Loading team workspace…</p> : null}

        <section className="rounded-xl border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Foundations</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Include design system colors, typography, effects, and spacing as default context for generated designs.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition ${
                  includeFoundations
                    ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                    : 'cursor-pointer bg-background hover:bg-muted'
                }`}
              >
                <UploadIcon className="h-3.5 w-3.5" />
                {customFoundationImage ? 'Replace custom image' : 'Upload custom image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={includeFoundations || !canEdit}
                  onChange={(event) => {
                    void updateCustomFoundationImage(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <label className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeFoundations}
                  disabled={!canEdit}
                  onChange={(event) => updateIncludeFoundations(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Included
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            {foundationCount > 0 ? (
              <p>
                Current foundation context contains {foundations.colors.length} color(s), {foundations.typography.length} typography
                style(s), {foundations.effects.length} effect(s), and {foundations.spacing.length} spacing token(s).
              </p>
            ) : (
              <p>No foundations were found in the current token source.</p>
            )}
          </div>

          {customFoundationImage ? (
            <div className="mt-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Custom foundation image</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used instead of generated foundation tokens when Foundations is not included.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={!canEdit}
                  onClick={removeCustomFoundationImage}
                  aria-label="Remove custom foundation image"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-3 overflow-hidden rounded-md border bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={customFoundationImage} alt="Custom foundation reference" className="h-40 w-full object-contain" />
              </div>
            </div>
          ) : null}

          {foundations.colors.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Colors</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {foundations.colors.slice(0, 24).map((color, index) => (
                  <span
                    key={`${color.name}-${index}`}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    title={color.value}
                  >
                    <span className="h-3 w-3 rounded-sm border" style={{ background: color.value }} />
                    <span className="max-w-32 truncate">{color.name}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {foundations.typography.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Typography</h3>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {foundations.typography.slice(0, 12).map((item, index) => (
                  <p key={`${item.name}-${index}`} className="rounded-md border px-2 py-1">
                    <span className="font-medium text-foreground">{item.name}:</span> {item.line}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border bg-background p-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Components</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Save reference images for default component styling. These are always attached to design generation requests.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {COMPONENT_REFERENCE_SETTINGS.map((setting) => {
              const image = componentReferences[setting.id];
              return (
                <div key={setting.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">{setting.label}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                    </div>
                    {image ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        disabled={!canEdit}
                        onClick={() => removeComponentReference(setting)}
                        aria-label={`Remove ${setting.label} reference`}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {image ? (
                      <div className="overflow-hidden rounded-md border bg-background">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image} alt={`${setting.label} reference`} className="h-36 w-full object-contain" />
                      </div>
                    ) : (
                      <div className="flex h-36 items-center justify-center rounded-md border border-dashed bg-background text-xs text-muted-foreground">
                        No image uploaded
                      </div>
                    )}
                  </div>

                  <label
                    className={`mt-3 inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm shadow-sm transition ${
                      canEdit ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <UploadIcon className="h-3.5 w-3.5" />
                    Upload image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={!canEdit}
                      onChange={(event) => {
                        void updateComponentReference(setting, event.currentTarget.files?.[0]);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Design.MD</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add markdown design guidelines that should be included with every design generation request.
            </p>
          </div>

          <Textarea
            value={designMd}
            onChange={(event) => updateDesignMd(event.target.value)}
            readOnly={!canEdit}
            rows={10}
            className="mt-4 font-mono text-sm"
            placeholder={`## Interaction guidelines\n- Use concise button labels\n- Keep forms compact and accessible\n\n## Visual rules\n- Prefer existing brand colors and spacing`}
            aria-label="Design markdown guidelines"
          />
        </section>

        <section className="rounded-xl border bg-background p-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Brand Voice</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add copy guidelines that should shape generated headlines, CTAs, body copy, and sample UI text.
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {BRAND_VOICE_SETTINGS.map((setting) => (
              <div key={setting.id}>
                <label className="text-sm font-medium" htmlFor={`brand-voice-${setting.id}`}>
                  {setting.label}
                </label>
                <Textarea
                  id={`brand-voice-${setting.id}`}
                  value={brandVoice[setting.id] || ''}
                  onChange={(event) => updateBrandVoice(setting, event.target.value)}
                  readOnly={!canEdit}
                  rows={5}
                  className="mt-2 text-sm"
                  placeholder={setting.placeholder}
                  aria-label={`Brand voice ${setting.label}`}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
