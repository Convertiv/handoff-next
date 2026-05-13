'use client';

import { BuildStatusBanner } from '@handoff/app/components/Component/BuildStatusBanner';
import { CodeEditor } from '@handoff/app/components/Component/CodeEditor';
import { InlineComponentEditor } from '@handoff/app/components/Component/InlineComponentEditor';
import { ComponentPreview } from '@handoff/app/components/Component/Preview';
import { HotReloadProvider } from '@handoff/app/components/context/HotReloadProvider';
import { PreviewContextProvider } from '@handoff/app/components/context/PreviewContext';
import Layout from '@handoff/app/components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '@handoff/app/components/Markdown/MarkdownComponents';
import AnchorNav from '@handoff/app/components/Navigation/AnchorNav';
import PrevNextNav from '@handoff/app/components/Navigation/PrevNextNav';
import HeadersType from '@handoff/app/components/Typography/Headers';
import { Badge } from '@handoff/app/components/ui/badge';
import { Button } from '@handoff/app/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@handoff/app/components/ui/drawer';
import { JsonTreeView } from '@handoff/app/components/ui/json-tree-view';
import { OptionalPreviewRender } from '@handoff/transformers/preview/types';
import { PreviewObject } from '@handoff/types/preview';
import { evaluateFilter, type Filter } from '@handoff/utils/filter';
import { Loader2, Pencil, Wrench, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

type GroupedPreviews = [string, Record<string, OptionalPreviewRender>][];

const groupPreviewsByVariantProperty = (items: Record<string, OptionalPreviewRender>, variantProperty: string): GroupedPreviews => {
  const grouped: GroupedPreviews = [];
  for (const itemId of Object.keys(items)) {
    const item = items[itemId];
    const typeProperty = item.values[variantProperty];
    if (!typeProperty) continue;
    const typeValue = typeProperty;
    const groupIndex = grouped.findIndex((el) => el[0] === typeValue);
    if (groupIndex === -1) {
      grouped.push([typeValue, { [itemId]: item }]);
    } else {
      grouped[groupIndex][1][itemId] = item;
    }
  }
  return grouped;
};

const toTitleCase = (str: string): string =>
  str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const toFigmaUrl = (fileKey?: string, nodeId?: string): string | null => {
  if (!fileKey || !nodeId) return null;
  return `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}`;
};

function filterPreviews(previews: Record<string, OptionalPreviewRender>, filter: Filter): Record<string, OptionalPreviewRender> {
  return Object.fromEntries(Object.entries(previews).filter(([, preview]) => evaluateFilter(preview.values, filter)));
}

export default function ComponentDetailClient({ id, menu, config, current, metadata, componentHotReloadIsAvailable, previousComponent, nextComponent }) {
  const [component, setComponent] = useState<PreviewObject>(undefined);
  const ref = React.useRef<HTMLDivElement>(null);
  const [componentPreviews, setComponentPreviews] = useState<PreviewObject | [string, PreviewObject][]>();
  const [hotKey, setHotKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data: session, status } = useSession();
  const canEditDynamic = useMemo(
    () => status === 'authenticated' && Boolean(session?.user) && session?.user?.role === 'admin',
    [session?.user, status]
  );

  const appBasePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const normalizedBasePath = appBasePath ? `/${appBasePath.replace(/^\/+|\/+$/g, '')}` : '';
  const componentRoute = (componentId: string) => `${normalizedBasePath}/system/component/${componentId}`;

  const fetchComponentData = useCallback(async () => {
    const staticRes = await fetch(`${normalizedBasePath}/api/component/${id}.json`);
    if (staticRes.ok) {
      const data = await staticRes.json();
      setComponent(data as PreviewObject);
      setHotKey((k) => k + 1);
      return;
    }
    const dbRes = await fetch(`${normalizedBasePath}/api/handoff/components?id=${encodeURIComponent(id)}`, { credentials: 'include' });
    if (dbRes.ok) {
      const row = await dbRes.json();
      const data = row.data && typeof row.data === 'object' ? row.data : row;
      setComponent(data as PreviewObject);
      setHotKey((k) => k + 1);
      return;
    }
    setComponent(undefined);
  }, [id, normalizedBasePath]);

  const previousLink = previousComponent ? { href: componentRoute(previousComponent.id), title: previousComponent.name } : null;
  const nextLink = nextComponent ? { href: componentRoute(nextComponent.id), title: nextComponent.name } : null;

  const syncFigmaMetadata = useCallback(async () => {
    setSyncBusy(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch(`${normalizedBasePath}/api/handoff/figma/components/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'sync_metadata', componentId: id, figmaComponentKey: component?.figmaComponentKey }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || 'Figma sync failed');
      setSyncMessage(json.message ?? 'Figma metadata synced.');
      await fetchComponentData();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Figma sync failed');
    } finally {
      setSyncBusy(false);
    }
  }, [component?.figmaComponentKey, fetchComponentData, id, normalizedBasePath]);

  useEffect(() => {
    setComponent(undefined);
    void fetchComponentData();
  }, [fetchComponentData, id]);

  useEffect(() => {
    if (!component) return;
    let filteredPreviews = component.previews;
    if (component.options?.preview?.filterBy) {
      filteredPreviews = filterPreviews(component.previews, component.options.preview.filterBy);
    }
    if (component.options?.preview?.groupBy) {
      const groups = groupPreviewsByVariantProperty(filteredPreviews, component.options.preview.groupBy);
      setComponentPreviews(
        groups.map(([group, previewObjects]) => [
          toTitleCase(`${group} ${id}`),
          { ...component, id: `${id}-${group}`, previews: previewObjects } as PreviewObject,
        ])
      );
    } else {
      setComponentPreviews({ ...component, previews: filteredPreviews });
    }
  }, [component, id]);

  if (!component) return <p>Loading...</p>;
  const apiUrl = (typeof window !== 'undefined' ? window.location.origin : '') + `${normalizedBasePath}/api/component/${id}.json`;

  const displayTitle = component.title || metadata.title;
  const displayDescription = component.description ?? metadata.description ?? '';
  const figmaHref = component.figma || toFigmaUrl(component.figmaFileKey, component.figmaNodeId);
  const figmaStatusLabel = component.figmaMatchStatus ? component.figmaMatchStatus.replace(/_/g, ' ') : null;
  const hasFigmaImages = Boolean(component.figmaImages?.length);

  const isEditing = canEditDynamic && editing;
  const bestPracticesForSlice = (cpi: number) => !isEditing && cpi === 0;
  const bestPracticesSingle = !isEditing;

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-3 pb-14">
        <small className="text-sm font-medium text-sky-600 dark:text-gray-300">Components</small>
        <HeadersType.H1>{displayTitle}</HeadersType.H1>
        <div className="flex flex-row justify-between gap-4 md:flex-col">
          <div className="prose max-w-[800px] text-xl font-light leading-relaxed text-gray-600 dark:text-gray-300">
            <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
              {displayDescription}
            </ReactMarkdown>
          </div>
          <div className="flex flex-row gap-3">
            {canEditDynamic && (
              <Button
                variant={editing ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5 font-normal [&_svg]:size-3!"
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? <><X strokeWidth={2} /> Done editing</> : <><Pencil strokeWidth={2} /> Edit</>}
              </Button>
            )}
            {figmaHref && (
              <Button asChild variant="outline" size="sm" className="font-normal [&_svg]:size-3!">
                <a href={figmaHref} target="_blank" rel="noreferrer">Figma Reference</a>
              </Button>
            )}
            {canEditDynamic && component.figmaMatchStatus !== 'missing_in_figma' ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-normal [&_svg]:size-3!"
                onClick={() => void syncFigmaMetadata()}
                disabled={syncBusy}
              >
                {syncBusy ? <Loader2 className="animate-spin" strokeWidth={2} /> : <Wrench strokeWidth={2} />}
                {syncBusy ? 'Syncing…' : 'Sync metadata'}
              </Button>
            ) : null}
            <Drawer direction="right">
              <DrawerTrigger asChild>
                <Button variant="outline" size="sm" className="font-normal [&_svg]:size-3!">
                  API Reference
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <div className="mx-5 w-full max-w-lg">
                  <DrawerHeader>
                    <DrawerTitle>API Response</DrawerTitle>
                    <p className="font-mono text-xs text-gray-500">{apiUrl}</p>
                  </DrawerHeader>
                  <div className="max-h-[80vh] w-full overflow-auto">
                    <JsonTreeView data={component} />
                  </div>
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        </div>
        {component.figmaMatchStatus || component.figmaComponentName || component.figmaMissingMetadata?.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-300">
            {figmaStatusLabel ? <Badge variant={component.figmaMatchStatus === 'matched' ? 'secondary' : 'outline'}>Figma {figmaStatusLabel}</Badge> : null}
            {component.figmaMatchedBy ? <Badge variant="outline">Matched by {component.figmaMatchedBy.replace(/_/g, ' ')}</Badge> : null}
            {component.figmaComponentName ? <span>Component: {component.figmaComponentName}</span> : null}
            {component.figmaComponentKey ? <span>Key: <code>{component.figmaComponentKey}</code></span> : null}
            {component.figmaVariantLabel ? <span>Variant: {component.figmaVariantLabel}</span> : null}
            {component.figmaComponentSetName ? <span>Set: {component.figmaComponentSetName}</span> : null}
            {component.figmaComponentSetId ? <span>Set node: <code>{component.figmaComponentSetId}</code></span> : null}
            {component.figmaFileKey ? <span>File: <code>{component.figmaFileKey}</code></span> : null}
            {component.figmaNodeId ? <span>Node: <code>{component.figmaNodeId}</code></span> : null}
            {component.figmaInstanceCount !== undefined ? <span>Variants: {component.figmaInstanceCount}</span> : null}
            {component.figmaMissingMetadata?.length ? (
              <span>Missing metadata: {component.figmaMissingMetadata.join(', ')}</span>
            ) : null}
          </div>
        ) : null}
        {syncMessage ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{syncMessage}</p> : null}
        {syncError ? <p className="text-sm text-red-600">{syncError}</p> : null}
        {hasFigmaImages ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Figma Images</h2>
              <Badge variant="outline">{component.figmaImages.length}</Badge>
            </div>
            <div className="space-y-3">
              {component.figmaImages.map((image, index) => (
                <div key={`${image.name}-${image.part}-${index}`} className="rounded-md border border-border/80 bg-background p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{image.name}</span>
                    {image.role ? <Badge variant="outline">{image.role}</Badge> : null}
                    {image.part ? <Badge variant="outline">{image.part}</Badge> : null}
                    {image.width && image.height ? <Badge variant="outline">{image.width}x{image.height}</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {image.nodeId ? <span>Node: <code>{image.nodeId}</code></span> : null}
                    {image.imageRef ? <span>Ref: <code>{image.imageRef}</code></span> : null}
                    {image.url ? <span className="truncate">URL available</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {isEditing ? (
          <>
            <InlineComponentEditor
              componentId={id}
              preview={component}
              metadataTitle={metadata.title}
              metadataDescription={metadata.description ?? ''}
              onSaved={fetchComponentData}
            />
            <BuildStatusBanner componentId={id} onBuildComplete={fetchComponentData} />
            <CodeEditor componentId={id} preview={component} onSourcesSaved={fetchComponentData} />
          </>
        ) : null}
      </div>
      <div ref={ref} className="lg:gap-10 lg:pb-8 xl:grid xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="max-w-[900px]">
          {Array.isArray(componentPreviews) ? (
            <HotReloadProvider key={`hot-reload-${id}-${hotKey}`} connect={componentHotReloadIsAvailable}>
              {componentPreviews.map(([title, cp], cpi) => (
                <React.Fragment key={`${id}-${cp.id}`}>
                  <PreviewContextProvider key={`preview-context-${cp.id}`} id={id} defaultMetadata={metadata} defaultMenu={menu} defaultPreview={cp} defaultConfig={config}>
                    <ComponentPreview
                      key={`component-preview-${cp.id}`}
                      title={title}
                      bestPracticesCard={bestPracticesForSlice(cpi)}
                      properties={cpi === componentPreviews.length - 1}
                      validations={cpi === componentPreviews.length - 1}
                    >
                      <p>Define a simple contact form</p>
                    </ComponentPreview>
                  </PreviewContextProvider>
                </React.Fragment>
              ))}
            </HotReloadProvider>
          ) : (
            <HotReloadProvider key={`hot-reload-${id}-${hotKey}`} connect={componentHotReloadIsAvailable}>
              <PreviewContextProvider key={`preview-context-${id}`} id={id} defaultMetadata={metadata} defaultMenu={menu} defaultPreview={componentPreviews} defaultConfig={config}>
                <ComponentPreview key={`component-preview-${id}`} title={metadata.title} bestPracticesCard={bestPracticesSingle} properties validations>
                  <p>Define a simple contact form</p>
                </ComponentPreview>
              </PreviewContextProvider>
            </HotReloadProvider>
          )}
          <hr className="mt-8" />
          <PrevNextNav previous={previousLink} next={nextLink} />
        </div>
        {Array.isArray(componentPreviews) ? (
          <AnchorNav groups={[{ 'best-practices': 'Best Practices', ...componentPreviews.reduce((acc, [title, po]) => ({ ...acc, [po.id]: title }), {}), 'code-highlight': 'Code Samples', properties: 'Properties', validations: 'Validations' }]} />
        ) : (
          <AnchorNav groups={[{ 'best-practices': 'Best Practices', preview: 'Previews', 'code-highlight': 'Code Samples', properties: 'Properties', validations: 'Validations' }]} />
        )}
      </div>
    </Layout>
  );
}
