'use client';

import { OptionalPreviewRender } from '@handoff/transformers/preview/types';
import { PreviewObject } from '@handoff/types/preview';
import { evaluateFilter, type Filter } from '@handoff/utils/filter';
import { Download, Pencil, X } from 'lucide-react';
import { startCase } from 'lodash';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { BuildStatusBanner } from '../../../../components/Component/BuildStatusBanner';
import { CodeEditor } from '../../../../components/Component/CodeEditor';
import { InlineComponentEditor } from '../../../../components/Component/InlineComponentEditor';
import { ComponentPreview } from '../../../../components/Component/Preview';
import { HotReloadProvider } from '../../../../components/context/HotReloadProvider';
import { PreviewContextProvider } from '../../../../components/context/PreviewContext';
import Layout from '../../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../../components/Navigation/PrevNextNav';
import HeadersType from '../../../../components/Typography/Headers';
import { handoffApiUrl } from '../../../../lib/api-path';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '../../../../components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { JsonTreeView } from '../../../../components/ui/json-tree-view';

type GroupedPreviews = [string, Record<string, OptionalPreviewRender>][];

type EntryDirRow = { relative: string; absolute: string };

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

function filterPreviews(previews: Record<string, OptionalPreviewRender>, filter: Filter): Record<string, OptionalPreviewRender> {
  return Object.fromEntries(Object.entries(previews).filter(([, preview]) => evaluateFilter(preview.values, filter)));
}

export default function ComponentDetailClient({ id, menu, config, current, metadata, componentHotReloadIsAvailable, previousComponent, nextComponent }) {
  const [component, setComponent] = useState<PreviewObject>(undefined);
  const ref = React.useRef<HTMLDivElement>(null);
  const [componentPreviews, setComponentPreviews] = useState<PreviewObject | [string, PreviewObject][]>();
  const [hotKey, setHotKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportDirDialogOpen, setExportDirDialogOpen] = useState(false);
  const [exportDirOptions, setExportDirOptions] = useState<EntryDirRow[]>([]);
  const [selectedExportDir, setSelectedExportDir] = useState('');

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

  useEffect(() => {
    setComponent(undefined);
    void fetchComponentData();
  }, [fetchComponentData, id]);

  const postExport = useCallback(
    async (outputDir: string) => {
      const res = await fetch(handoffApiUrl('/api/handoff/components/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ componentIds: [id], autoCommit: true, outputDir }),
      });
      const data = (await res.json()) as { error?: string; gitWarning?: string; commitSha?: string };
      if (!res.ok) throw new Error(data.error ?? 'Export failed');
      const extra = [data.commitSha ? `Commit ${data.commitSha.slice(0, 7)}` : null, data.gitWarning].filter(Boolean).join(' — ');
      alert(extra ? `Exported. ${extra}` : 'Exported.');
    },
    [id]
  );

  const exportToCode = useCallback(async () => {
    setExportBusy(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/entry-dirs'), { credentials: 'include' });
      const data = (await res.json()) as { error?: string; dirs?: EntryDirRow[] };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load export destinations');
      const dirs = data.dirs ?? [];
      let outputDir = 'components';
      if (dirs.length === 1) outputDir = dirs[0]!.relative;
      if (dirs.length > 1) {
        setExportDirOptions(dirs);
        setSelectedExportDir(dirs[0]!.relative);
        setExportDirDialogOpen(true);
        return;
      }
      if (!confirm(`Export "${id}" to "${outputDir}" and git commit?`)) return;
      await postExport(outputDir);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  }, [id, postExport]);

  const confirmExportDirDialog = useCallback(async () => {
    if (!confirm(`Export "${id}" to "${selectedExportDir}" and git commit?`)) {
      setExportDirDialogOpen(false);
      return;
    }
    setExportDirDialogOpen(false);
    setExportBusy(true);
    try {
      await postExport(selectedExportDir);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  }, [id, postExport, selectedExportDir]);

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

  const isEditing = canEditDynamic && editing;
  const bestPracticesForSlice = (cpi: number) => !isEditing && cpi === 0;
  const bestPracticesSingle = !isEditing;

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <Dialog open={exportDirDialogOpen} onOpenChange={setExportDirDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose export folder</DialogTitle>
            <DialogDescription>
              Pick a directory from <code className="text-xs">handoff.config</code> <code className="text-xs">entries.components</code>. Files
              are written under the linked project root.
            </DialogDescription>
          </DialogHeader>
          <Select value={selectedExportDir} onValueChange={setSelectedExportDir}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select folder" />
            </SelectTrigger>
            <SelectContent>
              {exportDirOptions.map((d) => (
                <SelectItem key={d.relative} value={d.relative}>
                  {d.relative}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setExportDirDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void confirmExportDirDialog()}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            {canEditDynamic ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 font-normal [&_svg]:size-3!"
                disabled={exportBusy}
                onClick={() => void exportToCode()}
              >
                <Download strokeWidth={2} className="size-3" />
                {exportBusy ? 'Exporting…' : 'Export to code'}
              </Button>
            ) : null}
            {component.figma && (
              <Button asChild variant="outline" size="sm" className="font-normal [&_svg]:size-3!">
                <a href={component.figma} target="_blank">Figma Reference</a>
              </Button>
            )}
            <Drawer direction="right">
              <DrawerTrigger>
                <Button variant="outline" size="sm" className="font-normal [&_svg]:size-3!">API Reference</Button>
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
