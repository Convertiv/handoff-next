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
  FileCodeIcon,
  FolderOpen,
  Layers,
  Maximize,
  Minimize,
  Monitor,
  PanelLeft,
  Plus,
  SaveIcon,
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
import PatternPicker from './PatternPicker';
import { savePatternAsTemplate } from '@/app/actions/patterns';
import SavePatternDialog from './SavePatternDialog';
import TemplateManager from './TemplateManager';
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

export default function PlaygroundBuilder() {
  const {
    selectedComponents,
    loading,
    error,
    onDragEnd,
    removeComponent,
    templates,
    saveAsTemplate,
    activeComponentId,
    setActiveComponentId,
    editingPatternId,
    setEditingPatternId,
    loadPatternById,
    isDynamicApp,
    updateComponent,
    saveState,
    recoveredDraft,
    restoreRecoveredDraft,
    discardRecoveredDraft,
  } = usePlayground();

  const [html, setHtml] = useState('');
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [savePatternOpen, setSavePatternOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [patternPickerOpen, setPatternPickerOpen] = useState(false);
  const [viewport, setViewport] = useState<ViewportKey>('desktop');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  // Open when starting a new page, closed when opening an existing pattern. A blank canvas has nothing
  // to look at yet, so the chat IS the starting point; arriving to edit a saved pattern is a different
  // intent and shouldn't have the preview narrowed for it.
  const [aiPanelOpen, setAiPanelOpen] = useState(() => !editingPatternId);
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
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
      const result = await constructComponentPreview(selectedComponents, basePath, { injectBlockControls: true });
      setHtml(result);
      setLoadingHtml(false);
    };
    render();
  }, [selectedComponents, basePath]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'playground-block-action') {
        const { action, blockId } = event.data;
        if (action === 'edit') {
          setActiveComponentId(blockId);
        } else if (action === 'delete') {
          removeComponent(blockId);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setActiveComponentId, removeComponent]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"></div>
          <p className="mt-3 text-sm text-muted-foreground">Loading components…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-sm text-destructive">{error}</p>
          <Button onClick={() => window.location.reload()} size="sm">Try Again</Button>
        </div>
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
  const handleSaveAsTemplate = async () => {
    if (!editingPatternId) return;
    const name = prompt('Name this template', 'Untitled template');
    if (name === null) return;
    setSavingTemplate(true);
    try {
      const result = await savePatternAsTemplate(editingPatternId, name.trim() || undefined);
      setTemplateNotice(`Saved “${result.title}” as a template. Your page is untouched.`);
    } catch (e) {
      setTemplateNotice(e instanceof Error ? e.message : 'Could not save the template.');
    } finally {
      setSavingTemplate(false);
    }
  };

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

          {(templates.length > 0 || isDynamicApp) && <TemplateManager />}

          {isDynamicApp && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setPatternPickerOpen(true)}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open a page</TooltipContent>
              </Tooltip>
              {/**
                * No "save page" here any more: in dynamic mode the page autosaves and creates itself on the
                * first block (roadmap E.2/E.3). What remains is the action that actually needs a decision —
                * turning this page into a template others can build from.
                */}
              {selectedComponents.length > 0 && editingPatternId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={savingTemplate}
                      onClick={() => void handleSaveAsTemplate()}
                    >
                      <SaveIcon className="h-4 w-4" />
                      <span className="text-xs">{savingTemplate ? 'Saving…' : 'Save as template'}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Create a frozen, team-visible template from this page. Your page stays yours.
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}

          {selectedComponents.length > 0 && (
            <>
              {/* Static (no-database) mode has nothing to autosave to, so the explicit save stays there —
                  and only there. The browser-local template store is no longer offered as a new place to
                  put work; existing local templates remain loadable so they can be converted. */}
              {!isDynamicApp && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setSavePatternOpen(true)}>
                      <SaveIcon className="h-4 w-4" />
                      <span className="text-xs">Save</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Save this page</TooltipContent>
                </Tooltip>
              )}

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
              className={`mr-2 text-xs ${saveState === 'failed' ? 'text-amber-700' : 'text-muted-foreground'}`}
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
            {activeComponent ? (
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
              {selectedComponents.length === 0 ? (
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
              )}
            </div>

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
              ) : (
                <Preview html={html} className="h-full" iframeRef={canvasIframeRef} />
              )}
            </div>
          </div>
        </div>

        {aiPanelOpen && <AiChatPanel />}
      </div>

      <SavePatternDialog
        open={savePatternOpen}
        onOpenChange={setSavePatternOpen}
        selectedComponents={selectedComponents}
        editingPatternId={editingPatternId}
        onSaved={(id) => setEditingPatternId(id)}
      />

      <PatternPicker
        open={patternPickerOpen}
        onOpenChange={setPatternPickerOpen}
        onPick={(id) => loadPatternById(id, true)}
      />
    </div>
  );
}
