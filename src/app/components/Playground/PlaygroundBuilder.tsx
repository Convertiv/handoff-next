'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import {
  ChevronDown,
  CopyIcon,
  FileCodeIcon,
  Layers,
  Maximize,
  Minimize,
  Monitor,
  PanelLeft,
  Plus,
  SaveIcon,
  UserPlus,
  Smartphone,
  ChevronLeft,
  SparklesIcon,
  Tablet,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePlayground } from './PlaygroundContext';
import AiChatPanel from './AiChatPanel';
import { EditContextProvider, useEditContext } from './EditContext';
import SortableItem from './SortableItem';
import Preview, { constructComponentPreview } from './Preview';
import ComponentLibrary from './ComponentLibrary';
import { useRouter } from 'next/navigation';
import { handoffApiUrl } from '@/lib/api-path';
import InviteWizard from './InviteWizard';
import MetaControl from '../library/MetaControl';
import MediaBrowser from './MediaBrowser';
import { renderFormFields } from './fields/Field';
import type { PlaygroundPageExport, SelectedPlaygroundComponent } from './types';

const VIEWPORTS = {
  desktop: { width: '100%', icon: Monitor, label: 'Desktop' },
  tablet: { width: '768px', icon: Tablet, label: 'Tablet' },
  mobile: { width: '375px', icon: Smartphone, label: 'Mobile' },
} as const;

type ViewportKey = keyof typeof VIEWPORTS;

function buildHandoffPageExport(selectedComponents: SelectedPlaygroundComponent[]): PlaygroundPageExport {
  return {
    title: 'Playground Page',
    description: '',
    group: 'Playground',
    components: selectedComponents.map((c) => c.id),
    previews: {
      default: {
        title: 'Default',
        values: selectedComponents.map((c) => c.data ?? {}),
      },
    },
  };
}

/**
 * The block editor, shown in place of the block list rather than beside it.
 *
 * Editing one block is a mode, not a second thing to look at: the list and the editor were competing
 * for attention in two rails while the canvas — the thing you are actually judging — got squeezed
 * between them. Swapping within one rail gives the preview the width back and makes "which block am I
 * editing" unambiguous.
 *
 * Both exits return to the list. Cancel simply discards: `EditContext` keeps edits local until
 * `handleSave` commits them, so leaving without saving needs no undo.
 */
function BlockEditorPanel({ onDone }: { onDone: () => void }) {
  const { component, properties, data, handleSave } = useEditContext();
  if (!component) return null;

  return (
    <>
      <div className="flex items-start gap-2 border-b px-3 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-6 w-6 shrink-0 p-0"
          onClick={onDone}
          aria-label="Back to blocks"
          title="Back to blocks"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{component.title}</h3>
          {component.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{component.description}</p>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {renderFormFields(properties, data)}
      </div>
      <div className="flex gap-2 border-t p-3">
        <Button variant="outline" size="sm" className="flex-1" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={() => {
            handleSave();
            onDone();
          }}
        >
          Apply
        </Button>
      </div>
    </>
  );
}

/**
 * The one shell for every level of a page (roadmap E.8).
 *
 * A page, a brief, and a build made from that brief are all the same object shape rendered with different write
 * capability, so they get the same toolbar and the same canvas — only the left panel changes. Before this,
 * a brief had its own route and its own 30/70 layout, which is exactly why it read as a third product instead
 * of a deeper view of the page ("It makes it unclear what's happening" — Brad, 2026-08-06).
 *
 * @param leftPanel Replaces the blocks list / block editor entirely. Set at brief and build level, where there
 *   is no structure to edit and the panel is about the invitation or the submission instead.
 * @param canvasControls When false the preview gets **no** injected affordances at all — not even the edit
 *   pencil `structuralEditing: false` keeps for guests. A frozen brief or someone else's build must not offer
 *   a control the write path would refuse.
 */
export default function PlaygroundBuilder({
  leftPanel,
  canvasControls = true,
  buildCount = 0,
  onShowBuilds,
}: {
  leftPanel?: React.ReactNode;
  canvasControls?: boolean;
  /** Builds waiting across all of this page's invitations. Only used to label the control. */
  buildCount?: number;
  /** Set at page level to offer the builds list without leaving the page. */
  onShowBuilds?: () => void;
} = {}) {
  const {
    selectedComponents,
    loading,
    error,
    onDragEnd,
    removeComponent,
    activeComponentId,
    setActiveComponentId,
    editingPatternId,
    setEditingPatternId,
    isDynamicApp,
    updateComponent,
    saveState,
    pageTitle,
    briefs,
    refreshBriefs,
    structuralEditing,
    aiAssistantEnabled,
    recoveredDraft,
    restoreRecoveredDraft,
    discardRecoveredDraft,
  } = usePlayground();

  const [html, setHtml] = useState('');
  const [loadingHtml, setLoadingHtml] = useState(false);
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  const [viewport, setViewport] = useState<ViewportKey>('desktop');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  // Open when starting a new page, closed when opening an existing pattern. A blank canvas has nothing
  // to look at yet, so the chat IS the starting point; arriving to edit a saved pattern is a different
  // intent and shouldn't have the preview narrowed for it.
  const [aiPanelOpen, setAiPanelOpen] = useState(() => aiAssistantEnabled && !editingPatternId);
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  const [duplicating, setDuplicating] = useState(false);

  /**
   * Clone this page into one of your own (E.6) — how an internal user starts from someone else's team or
   * public page.
   *
   * Lives on the page, not on the library card. It was briefly a card affordance and that was wrong twice
   * over: a card is a link, and "duplicate this" is something you decide *after* looking at the thing.
   */
  const duplicatePage = useCallback(async () => {
    if (!editingPatternId) return;
    setDuplicating(true);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(editingPatternId)}/clone`), {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error || 'Could not duplicate this page.');
      router.push(`${basePath}/playground/${encodeURIComponent(json.id)}`);
    } catch (e) {
      setTemplateNotice(e instanceof Error ? e.message : 'Could not duplicate this page.');
      setDuplicating(false);
    }
  }, [editingPatternId, router, basePath]);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  // The canvas preview iframe — shared with the right-panel editor so field
  // edits live-update the real page via postMessage (no full canvas rebuild).
  const canvasIframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!previewContainerRef.current) return;
    if (!document.fullscreenElement) {
      previewContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeComponent = selectedComponents.find((c) => c.uniqueId === activeComponentId) ?? null;

  // Bring the selected block into view in the canvas. Paired with the listener injected by
  // `getBlockControlsScript`; posting to a canvas that has not finished loading is a no-op, and the
  // next selection will land, so no retry is needed.
  useEffect(() => {
    if (!activeComponentId) return;
    canvasIframeRef.current?.contentWindow?.postMessage(
      { type: 'playground-scroll-to-block', blockId: activeComponentId },
      '*'
    );
  }, [activeComponentId]);

  useEffect(() => {
    const render = async () => {
      setLoadingHtml(true);
      const result = await constructComponentPreview(selectedComponents, basePath, {
        injectBlockControls: canvasControls,
        // Edit yes, remove no, when the structure is fixed (roadmap E.5).
        allowDelete: structuralEditing && canvasControls,
      });
      setHtml(result);
      setLoadingHtml(false);
    };
    render();
  }, [selectedComponents, basePath, structuralEditing, canvasControls]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'playground-block-action') {
        const { action, blockId } = event.data;
        if (action === 'edit') {
          setActiveComponentId(blockId);
        } else if (action === 'delete' && structuralEditing) {
          // Gated here as well as in the injected script: the iframe's messages are input, not instructions.
          removeComponent(blockId);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setActiveComponentId, removeComponent, structuralEditing]);

  /**
   * Loading and failure keep the left panel, when there is one.
   *
   * These used to replace the entire shell, which was harmless while the panel only ever held a block list. At
   * brief and build level (roadmap E.8) that panel is the **only way back to the page** — so a canvas that
   * failed to load would strand you on a "Try Again" button with no navigation at all.
   */
  if (loading || error) {
    const filler = error ? (
      <div className="text-center">
        <p className="mb-4 text-sm text-destructive">{error}</p>
        <Button onClick={() => window.location.reload()} size="sm">
          Try Again
        </Button>
      </div>
    ) : (
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"></div>
        <p className="mt-3 text-sm text-muted-foreground">Loading components…</p>
      </div>
    );

    if (!leftPanel) {
      return <div className="flex h-full items-center justify-center">{filler}</div>;
    }
    return (
      <div className="flex h-full min-h-0">
        {leftPanelOpen && (
          <div className="flex w-[300px] shrink-0 flex-col border-r bg-background">{leftPanel}</div>
        )}
        <div className="flex flex-1 items-center justify-center">{filler}</div>
      </div>
    );
  }

  const handleDownload = async () => {
    const downloadHtml = await constructComponentPreview(selectedComponents, basePath, { injectBlockControls: false });
    const blob = new Blob([downloadHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'page.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPage = () => {
    const pageExport = buildHandoffPageExport(selectedComponents);
    const blob = new Blob([JSON.stringify(pageExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playground-page.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Save this page as a template — a separate, frozen, team-visible copy (roadmap E.2).
   *
   * Not a rename of the old browser-local "template", which only ever existed in one person's browser and
   * was invisible to sharing and review. This creates a real record others can clone from and guests can
   * build from, and leaves this page alone.
   */
  if (wizardOpen && editingPatternId) {
    return (
      <InviteWizard
        pageId={editingPatternId}
        pageTitle={pageTitle}
        onCancel={() => setWizardOpen(false)}
        onCreated={() => void refreshBriefs()}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Top Toolbar ── */}
      <div className="relative flex h-12 shrink-0 items-center border-b bg-background px-2">
        {/* Left group */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setLeftPanelOpen(!leftPanelOpen)}>
                <PanelLeft className={cn('h-4 w-4 transition-colors', leftPanelOpen && 'text-primary')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{leftPanelOpen ? 'Hide blocks' : 'Show blocks'}</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-4 w-px bg-border" />


          {isDynamicApp && (
            <>
              {/* No "open a page" control: pages are opened from /library, which is their home, and each
                  one has a real URL (roadmap E.2c). One place to browse, not two. */}
              {/**
                * No "save page" here any more: in dynamic mode the page autosaves and creates itself on the
                * first block (roadmap E.2/E.3). What remains is the action that actually needs a decision —
                * turning this page into a template others can build from.
                */}
              {/* Visibility + lifecycle, where the page is. Replaces the old read-only "Share" link control:
                  handing a page to someone is "Invite to build", and who may see it is this. */}
              {editingPatternId && <MetaControl resourceType="pattern" resourceId={editingPatternId} basePath={basePath} />}

              {editingPatternId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={duplicating}
                      onClick={() => void duplicatePage()}
                    >
                      <CopyIcon className="h-4 w-4" />
                      <span className="text-xs">Duplicate</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Make your own copy of this page</TooltipContent>
                </Tooltip>
              )}

              {/* The work coming back, reachable from the page rather than only through a brief (E.8). */}
              {onShowBuilds && buildCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={onShowBuilds}>
                      <Layers className="h-4 w-4" />
                      <span className="text-xs">Builds</span>
                      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{buildCount}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Pages people built from your invitations</TooltipContent>
                </Tooltip>
              )}

              {selectedComponents.length > 0 && editingPatternId && (
                <div className="flex items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2"
                        onClick={() => setWizardOpen(true)}
                      >
                        <UserPlus className="h-4 w-4" />
                        <span className="text-xs">Invite to build</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Send someone a link to build their own version of this page. Your page stays yours.
                    </TooltipContent>
                  </Tooltip>

                  {/* The arrow only appears once there is something to list — an empty dropdown is a dead end. */}
                  {briefs.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-6 px-0" aria-label="Invitations">
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        {briefs.map((brief) => (
                          <DropdownMenuItem
                            key={brief.id}
                            /* Same page, deeper level (roadmap E.8) — not a different route. */
                            onClick={() => router.push(`?brief=${encodeURIComponent(brief.id)}`)}
                            className="flex flex-col items-start gap-0.5"
                          >
                            <span className="text-sm font-medium">
                              v{brief.version ?? '?'} · {brief.title || 'Untitled'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {brief.createdAt ? new Date(brief.createdAt).toLocaleDateString() : ''}
                              {brief.builtCount ? ` · ${brief.builtCount} built` : ' · nothing built yet'}
                              {brief.linkCount ? ` · ${brief.linkCount} active link${brief.linkCount === 1 ? '' : 's'}` : ''}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              )}
            </>
          )}

          {selectedComponents.length > 0 && (
            <>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
                        <FileCodeIcon className="h-4 w-4" />
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Export</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={handleDownload}>Download as HTML</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadPage}>Download as Handoff page</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {aiAssistantEnabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setAiPanelOpen((v) => !v)}
                  aria-label={aiPanelOpen ? 'Hide AI builder' : 'Build with AI'}
                >
                  <SparklesIcon className={cn('h-4 w-4 transition-colors', aiPanelOpen && 'text-primary')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{aiPanelOpen ? 'Hide AI builder' : 'Build with AI'}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {/* Center group — viewport controls */}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-lg border bg-muted/50 p-0.5">
          {(Object.entries(VIEWPORTS) as [ViewportKey, (typeof VIEWPORTS)[ViewportKey]][]).map(([key, { icon: Icon, label }]) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setViewport(key)}
                  className={cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    viewport === key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Right group */}
        <div className="ml-auto flex items-center gap-1">
          {/* Autosave state for a page that has a record. Silent for a brand-new canvas, which has
              nothing to autosave to yet. */}
          {saveState !== 'off' ? (
            <span
              aria-live="polite"
              className={`mr-2 text-xs ${saveState === 'failed' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Not saved' : 'Unsaved changes'}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleFullscreen}>
                {isFullscreen
                  ? <Minimize className="h-4 w-4" />
                  : <Maximize className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{isFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}</TooltipContent>
          </Tooltip>

        </div>
      </div>

      {/* Recovery offer for a canvas left in local storage by an older build (roadmap E.3). Shown instead
          of silently restoring it, which is what made "New" reopen old work. Either action clears it. */}
      {recoveredDraft ? (
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2 text-sm">
          <span>
            You have an unsaved canvas from a previous visit ({recoveredDraft.count} block
            {recoveredDraft.count === 1 ? '' : 's'}).
          </span>
          <Button size="sm" variant="secondary" onClick={restoreRecoveredDraft}>
            Restore it
          </Button>
          <Button size="sm" variant="ghost" onClick={discardRecoveredDraft}>
            Start fresh
          </Button>
        </div>
      ) : null}

      {templateNotice ? (
        <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-sm">
          <span>{templateNotice}</span>
          <Button size="sm" variant="ghost" onClick={() => setTemplateNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* ── Main content area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel — Blocks, or the editor for one block ── */}
        {leftPanelOpen && (
          <div className="flex w-[300px] shrink-0 flex-col border-r bg-background">
            {leftPanel ? (
              leftPanel
            ) : activeComponent ? (
              <EditContextProvider
                key={activeComponent.uniqueId}
                component={activeComponent}
                onCommit={updateComponent}
                targetIframeRef={canvasIframeRef}
              >
                <BlockEditorPanel onDone={() => setActiveComponentId(null)} />
                <MediaBrowser />
              </EditContextProvider>
            ) : (
              <>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Blocks</span>
              </div>
              {selectedComponents.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {selectedComponents.length}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {selectedComponents.length === 0 && !structuralEditing ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  This page has no blocks yet.
                </p>
              ) : selectedComponents.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-4">
                  <ComponentLibrary
                    trigger={
                      <button className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/20 px-4 py-10 text-center transition-colors hover:border-primary/30 hover:bg-muted/30">
                        <div className="rounded-full bg-muted p-3">
                          <Plus className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Add your first block</p>
                          <p className="mt-1 text-xs text-muted-foreground/70">Browse the component library</p>
                        </div>
                      </button>
                    }
                  />
                </div>
              ) : (
                /**
                 * Same rail either way, minus the drag context and the remove control when the structure is
                 * fixed. Wrapping in DndContext but ignoring drops would still show grab cursors and drag
                 * shadows for something that cannot happen.
                 */
                (structuralEditing ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={selectedComponents.map((c) => c.uniqueId)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-0.5">
                        {selectedComponents.map((component) => (
                          <SortableItem
                            key={component.uniqueId}
                            component={component}
                            isActive={component.uniqueId === activeComponentId}
                            onClick={() => setActiveComponentId(
                              component.uniqueId === activeComponentId ? null : component.uniqueId
                            )}
                            onRemove={removeComponent}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="space-y-0.5">
                    {selectedComponents.map((component) => (
                      <button
                        key={component.uniqueId}
                        type="button"
                        onClick={() => setActiveComponentId(
                          component.uniqueId === activeComponentId ? null : component.uniqueId
                        )}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                          component.uniqueId === activeComponentId ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                        )}
                      >
                        <span className="truncate">{component.title}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            {structuralEditing ? (
              <div className="border-t p-3">
                <ComponentLibrary
                  trigger={
                    <Button variant="outline" size="sm" className="w-full gap-2 border-dashed">
                      <Plus className="h-4 w-4" />
                      Add Block
                    </Button>
                  }
                />
              </div>
            ) : null}
              </>
            )}
          </div>
        )}

        {/* ── Center — Preview Canvas ── */}
        <div ref={previewContainerRef} className="flex flex-1 flex-col overflow-hidden bg-background">
          <div
            className={cn(
              'flex flex-1 overflow-auto',
              viewport === 'desktop'
                ? 'p-0'
                : 'items-start justify-center bg-muted/30 p-6 dark:bg-muted/10'
            )}
          >
            <div
              className={cn(
                'h-full w-full transition-[max-width] duration-300',
                viewport !== 'desktop' && 'mx-auto overflow-hidden rounded-lg border bg-background shadow-md'
              )}
              style={{
                maxWidth: VIEWPORTS[viewport].width,
              }}
            >
              {loadingHtml ? (
                <div className="flex h-full items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"></div>
                </div>
              ) : selectedComponents.length === 0 ? (
                /**
                 * A muted placeholder rather than the blank white document an empty preview renders as — which
                 * read as a broken canvas in dark mode. Keyed on the blocks, not on `html`:
                 * `constructComponentPreview([])` returns a complete-but-empty document, so `html` is always
                 * truthy. The iframe's *contents* keep their own theme once there is something to show; this is
                 * only what fills the space when there is not.
                 */
                <div className="flex h-full items-center justify-center bg-muted/30 p-8">
                  <p className="max-w-sm text-center text-sm text-muted-foreground">
                    {structuralEditing
                      ? 'Add a block to see it here.'
                      : 'Nothing to preview yet — this page has no blocks.'}
                  </p>
                </div>
              ) : (
                <Preview html={html} className="h-full" iframeRef={canvasIframeRef} />
              )}
            </div>
          </div>
        </div>

        {aiAssistantEnabled && aiPanelOpen && <AiChatPanel />}
      </div>

    </div>
  );
}
