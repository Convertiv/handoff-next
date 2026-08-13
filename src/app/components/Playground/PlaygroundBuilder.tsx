'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import Preview, { constructComponentPreview, renderPreview } from './Preview';
import ComponentLibrary from './ComponentLibrary';
import { useRouter } from 'next/navigation';
import { handoffApiUrl } from '@/lib/api-path';
import ShareTemplate from './ShareTemplate';
import MetaControl from '../library/MetaControl';
import PageOrigin from '../library/PageOrigin';
import { fieldIdToArgsPath, richtextEditableFieldPaths, textEditableFieldPaths } from '@/lib/field-marks';
import { setAtArgsPath } from '@/lib/set-at-args-path';
import {
  FieldLinkProvider,
  REVEAL_FIELD_MESSAGE,
  fieldLinkKey,
  orderPropertiesByDocument,
  useFieldLink,
} from './FieldLinkContext';
import { componentFieldRules, declaredRuleForPath, resolveFieldGuardrail } from '@/lib/authoring-guardrails';
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
  const { documentOrder } = useFieldLink();
  /**
   * Fields in the order the page reads, not the order the schema happens to list (roadmap F.2).
   *
   * The canvas reports its marks in document order for free — a `TreeWalker` yields them that way — so this is
   * applying a fact rather than guessing at one. With no report (a React block, or a canvas still loading) the
   * schema order stands.
   */
  const ordered = useMemo(() => orderPropertiesByDocument(properties, documentOrder), [properties, documentOrder]);
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
        {renderFormFields(ordered, data)}
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
  /** How many pages have been made from this one. Only used to label the control. */
  buildCount?: number;
  /** Set at page level to offer that list without leaving the page. */
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
    structuralEditing,
    aiAssistantEnabled,
    contentOnly,
    guardrails,
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

  /**
   * The `maxLength` in force for the overlay's counter, **per block**.
   *
   * Resolved through `resolveFieldGuardrail` so the number in the canvas is the number the rail shows and the
   * server enforces — three places agreeing because they share one resolver, not because they were kept in step.
   * Keyed without a row index: one rule covers every row of a repeater.
   *
   * **Component declarations are included, not just the brief's fields.** Reading only `guardrails.fields` meant
   * the canvas counter appeared exclusively for brief-configured paths — so on a registry whose limits all come
   * from component contracts (SS&C: every one of them) the overlay showed no counter at all, while the rail showed
   * one and the server enforced it. That is the same class of gap as E.9's original `maxLength`-only read.
   *
   * **Per block rather than a union**, because two components can declare different limits for the same field
   * name — `title` is 60 on one and 80 on another — and a flat map would quietly show one block another's number.
   * The frame already knows its `blockId`, so it can look up its own.
   */
  const inlineFieldLimits = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const component of selectedComponents) {
      const blockId = component.uniqueId;
      if (!blockId) continue;
      const declared = componentFieldRules((component as { properties?: unknown }).properties);
      const forBlock: Record<string, number> = {};
      // Every path either side knows about: the component's own declarations plus the brief's overrides.
      for (const path of new Set([...Object.keys(declared), ...Object.keys(guardrails.fields ?? {})])) {
        const max = resolveFieldGuardrail(guardrails, path, declaredRuleForPath(declared, path)).maxLength;
        if (max) forBlock[path] = max;
      }
      if (Object.keys(forBlock).length) out[blockId] = forBlock;
    }
    return out;
  }, [guardrails, selectedComponents]);

  /**
   * Which field paths a text overlay may edit, unioned across the blocks on the canvas.
   *
   * Derived from each component's own contract, because the frame cannot know a declared type — and getting this
   * wrong is not cosmetic: a field wrapping a repeater reads back as its rows concatenated, and committing that
   * writes a string over an array. Union rather than per-block because the frame keys on the field path, and two
   * blocks sharing a path share a type in practice.
   */
  const inlineEditableFields = useMemo(() => {
    const out = new Set<string>();
    for (const c of selectedComponents) {
      for (const path of textEditableFieldPaths((c as { properties?: unknown }).properties)) out.add(path);
    }
    return [...out];
  }, [selectedComponents]);

  /**
   * The rail ↔ canvas link (roadmap F.2). Kept here because this is the one component that holds both ends: the
   * canvas iframe to post to, and the rail that renders the fields.
   */
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  /** Document order of marks, per block, as the frame reports it. */
  const [fieldOrderByBlock, setFieldOrderByBlock] = useState<Record<string, string[]>>({});

  /**
   * Hovering a field in the rail highlights it in the canvas.
   *
   * Posted straight to the frame rather than routed through state, so the canvas responds on the same tick the
   * pointer moves — and the frame is the only thing that can find the mark anyway.
   */
  const handleFieldHover = useCallback((path: string | null) => {
    setHoveredField(path);
    canvasIframeRef.current?.contentWindow?.postMessage(
      { type: 'playground-highlight-field', fieldId: path },
      '*'
    );
  }, []);

  const fieldLink = useMemo(
    () => ({
      hovered: hoveredField,
      onHover: handleFieldHover,
      documentOrder: activeComponentId ? (fieldOrderByBlock[activeComponentId] ?? null) : null,
    }),
    [hoveredField, handleFieldHover, activeComponentId, fieldOrderByBlock]
  );

  /**
   * Richtext paths, unioned across the canvas — roadmap F.2b.
   *
   * Separate from `inlineEditableFields` because the frame needs to know *which overlay* to open, not merely that a
   * field is editable. Same union-rather-than-per-block reasoning: the frame keys on the field path.
   */
  const inlineRichtextFields = useMemo(() => {
    const out = new Set<string>();
    for (const c of selectedComponents) {
      for (const path of richtextEditableFieldPaths((c as { properties?: unknown }).properties)) out.add(path);
    }
    return [...out];
  }, [selectedComponents]);

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

  /**
   * Where the canvas is scrolled to, as last reported by the frame.
   *
   * A ref, not state: this updates on every scrolled frame and re-rendering for it would be absurd — and it is
   * read only at the moment a rebuild is assembled. The frame is opaque-origin, so asking it is the only way to
   * know. See `getBlockControlsScript` for why a rebuild needs it at all.
   */
  const canvasScrollRef = useRef(0);

  useEffect(() => {
    const render = async () => {
      setLoadingHtml(true);
      const result = await constructComponentPreview(selectedComponents, basePath, {
        restoreScrollY: canvasScrollRef.current,
        injectBlockControls: canvasControls,
        // Edit yes, remove no, when the structure is fixed (roadmap E.5).
        allowDelete: structuralEditing && canvasControls,
        /**
         * Inline editing rides on the same flag as the block controls: both mean "this canvas is editable".
         * A React block carries no `{{#field}}` marks, so the script finds nothing and returns — no branch
         * needed, and no half-working affordance on a surface that cannot support it.
         */
        inlineEdit: canvasControls,
        /**
         * Navigation is injected whether or not this canvas is editable.
         *
         * A review canvas is exactly where "click the finding, see the problem" matters most, and it is the one
         * canvas that had no listener at all — the messages below were posted into a frame that ignored them.
         */
        fieldNavigation: !canvasControls,
        // A link in a preview is scenery, not a destination. Clicking one used to navigate the frame away.
        interceptLinks: true,
        fieldLimits: inlineFieldLimits,
        editableFields: inlineEditableFields,
        richtextFields: inlineRichtextFields,
      });
      setHtml(result);
      setLoadingHtml(false);
    };
    render();
    // Both inline lists are memoized, so including them costs nothing and closes a real staleness gap: a
    // guardrail edited while the canvas is open would otherwise leave the overlay counting against the old limit.
  }, [
    selectedComponents,
    basePath,
    structuralEditing,
    canvasControls,
    inlineFieldLimits,
    inlineEditableFields,
    inlineRichtextFields,
  ]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'playground-scroll') {
        if (typeof event.data.y === 'number') canvasScrollRef.current = event.data.y;
        return;
      }

      /**
       * The canvas telling the rail what the pointer is over, and which order its fields render in — the two
       * messages the frame has been emitting since F.2 with nothing listening (roadmap F.2).
       */
      /**
       * A findings list asking for a field to be shown (roadmap E.11). This is the only place that can satisfy it:
       * a finding names a block by *index*, and only the builder holds the ordered blocks to turn that into a
       * `uniqueId` — plus the canvas ref to point at.
       */
      if (event.data?.type === REVEAL_FIELD_MESSAGE) {
        const { blockIndex, path } = event.data as { blockIndex?: unknown; path?: unknown };
        if (typeof blockIndex !== 'number') return;
        const block = selectedComponents[blockIndex];
        if (!block?.uniqueId) return;

        // Open the block's editor in the rail. The field the finding is about is inside it.
        setActiveComponentId(block.uniqueId);

        const key = typeof path === 'string' && path ? fieldLinkKey(path) : null;
        setHoveredField(key);
        const frame = canvasIframeRef.current?.contentWindow;
        /**
         * Scroll first, then highlight. A page-level finding carries no path, so it still brings the block into
         * view — being shown the right block is most of the answer even when no single field is at fault.
         */
        /**
         * `flash` outlines the whole section on arrival; `reveal` centres the field inside it.
         *
         * Both only from here. Selecting a block in the rail posts the same scroll message, and a section that
         * flashes every time you click down a list is noise — this path is the one where you asked "show me the
         * thing this finding is about" and are looking for it.
         */
        frame?.postMessage({ type: 'playground-scroll-to-block', blockId: block.uniqueId, flash: true }, '*');
        frame?.postMessage({ type: 'playground-highlight-field', fieldId: key, reveal: true }, '*');
        return;
      }

      if (event.data?.type === 'playground-field-hover') {
        const id = event.data.fieldId;
        setHoveredField(typeof id === 'string' ? fieldLinkKey(id) : null);
        return;
      }
      if (event.data?.type === 'playground-fields') {
        const { fields } = event.data as { fields?: { id?: unknown; blockId?: unknown }[] };
        if (!Array.isArray(fields)) return;
        const next: Record<string, string[]> = {};
        for (const f of fields) {
          if (typeof f?.id !== 'string' || typeof f?.blockId !== 'string') continue;
          (next[f.blockId] ??= []).push(f.id);
        }
        // Replaced wholesale, not merged: the frame reports every mark in the document each time it loads, so a
        // stale block's order would otherwise outlive the block itself.
        setFieldOrderByBlock(next);
        return;
      }
      /** A field focused for inline editing selects it in the rail too, so the two views agree on "current". */
      if (event.data?.type === 'playground-field-focus') {
        const { blockId, fieldId } = event.data as { blockId?: unknown; fieldId?: unknown };
        if (typeof blockId === 'string') setActiveComponentId(blockId);
        if (typeof fieldId === 'string') setHoveredField(fieldLinkKey(fieldId));
        return;
      }

      if (event.data?.type === 'playground-block-action') {
        const { action, blockId } = event.data;
        if (action === 'edit') {
          setActiveComponentId(blockId);
        } else if (action === 'delete' && structuralEditing) {
          // Gated here as well as in the injected script: the iframe's messages are input, not instructions.
          removeComponent(blockId);
        }
        return;
      }

      /**
       * An inline edit committed in the canvas (roadmap F.2).
       *
       * Applied through the same `updateComponent` the rail writes with, so an inline edit is indistinguishable
       * downstream — autosave, guardrails and the audit all see an ordinary value change. The frame reports a
       * *mark id*; `fieldIdToArgsPath` turns it into the path the data actually uses, which is the join that has
       * to be right or an edit writes somewhere nothing renders.
       *
       * **`rendered` is refreshed too, and that is not optional**: `constructComponentPreview` draws a Handlebars
       * block from `component.rendered`, a cached HTML string, and never re-renders it from `data`. Committing
       * `data` alone updated the record and saved it, then rebuilt the canvas from the stale string — so the text
       * snapped back the instant it was committed and inline editing looked like it did not persist. This mirrors
       * what `EditContext.handleSave` does for the rail, for the same reason.
       *
       * Re-gated here: a message from the frame is input, not an instruction. Nothing is applied on a surface
       * that is not offering inline editing in the first place.
       */
      if (event.data?.type === 'playground-field-commit' && canvasControls) {
        const { blockId, fieldId, value } = event.data as { blockId?: string; fieldId?: string; value?: unknown };
        if (!blockId || !fieldId || typeof value !== 'string') return;
        const block = selectedComponents.find((c) => c.uniqueId === blockId);
        if (!block) return;

        const path = fieldIdToArgsPath(fieldId);
        if (!path.length) return;

        const nextData = setAtArgsPath(block.data, path, value);
        void (async () => {
          const updated = { ...block, data: nextData };
          updated.rendered = await renderPreview(updated, nextData, basePath);
          updateComponent(updated);
        })();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    setActiveComponentId,
    removeComponent,
    structuralEditing,
    canvasControls,
    selectedComponents,
    updateComponent,
    basePath,
  ]);

  /**
   * Loading and failure keep the left panel, when there is one.
   *
   * These used to replace the entire shell, which was harmless while the panel only ever held a block list. At
   * brief and build level (roadmap E.8) that panel is the **only way back to the page** — so a canvas that
   * failed to load would strand you on a "Try Again" button with no navigation at all.
   */
  /**
   * The page's content, as a manifest to read or a prompt to paste (reflow R.6).
   *
   * Fetched rather than assembled here: the route is the one place that decides what "the content of this
   * page" is, and a second assembly in the browser would be a second answer. The prompt goes to the clipboard
   * because its destination is an agent conversation; the manifest downloads because its destination is a
   * document somebody marks up.
   */
  const exportContent = useCallback(
    async (format: 'markdown' | 'prompt') => {
      if (!editingPatternId) return;
      try {
        const res = await fetch(
          handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(editingPatternId)}/manifest?format=${format}`),
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error('Could not build the export.');
        const text = await res.text();

        if (format === 'prompt') {
          await navigator.clipboard.writeText(text);
          setTemplateNotice('Prompt copied — paste it into an agent that has your CMS connected.');
          return;
        }

        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${editingPatternId}-content.md`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setTemplateNotice(e instanceof Error ? e.message : 'Could not build the export.');
      }
    },
    [editingPatternId]
  );

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
        {/**
          * Wider than the page-level rail — brief and build level (Brad, QA).
          *
          * Those levels have no right-hand panel at all, so the extra 60px comes out of empty space rather than out
          * of the canvas, and it is the panel people actually *work* in: findings, a note, a decision.
          */}
        {leftPanelOpen && (
          <div className="flex w-[360px] shrink-0 flex-col border-r bg-background">{leftPanel}</div>
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
   * Share this page as a template (reflow R.2).
   *
   * Replaces the three-step invite wizard, which existed because sharing used to produce a *brief* — an object
   * with a name, a version and a life of its own. Sharing now points a link at the template itself, so the
   * screen asks only what the link needs.
   */
  if (wizardOpen && editingPatternId) {
    return (
      <ShareTemplate
        templateId={editingPatternId}
        pageTitle={pageTitle}
        onCancel={() => setWizardOpen(false)}
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
              {/**
                * Where this page came from, for a page that came from somewhere (Brad, 2026-08-13).
                *
                * The R.4 provenance panel is only reachable by opening a page *through its template*; opened
                * from the library — the ordinary way — a guest's page looked like any other. Renders nothing
                * when there is no provenance, which is most pages.
                */}
              {editingPatternId && <PageOrigin pageId={editingPatternId} basePath={basePath} />}

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
                      {/* "Build" is gone as a product word — there are pages and templates (Brad, 2026-08-13). */}
                      <span className="text-xs">Pages</span>
                      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{buildCount}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Pages people made from this template</TooltipContent>
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
                        {/* The act is sharing a template, not issuing an invitation — "invite" implied a named
                            person and an object with a life of its own, and it is neither (reflow R.2). */}
                        <span className="text-xs">Share</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Give people a link to build their own page from this one. Yours stays yours.
                    </TooltipContent>
                  </Tooltip>

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
                  {/**
                    * The content of this page, as words (reflow R.6).
                    *
                    * Two exports off one artifact: a **manifest** for whoever has to read every string on the
                    * page without clicking through a canvas, and a **prompt** for an agent holding a CMS's MCP.
                    * Both need a saved page — there is no id to export before the first save.
                    */}
                  {editingPatternId ? (
                    <>
                      <DropdownMenuItem onClick={() => void exportContent('markdown')}>
                        Download content manifest
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void exportContent('prompt')}>
                        Copy “move to CMS” prompt
                      </DropdownMenuItem>
                    </>
                  ) : null}
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
              <FieldLinkProvider value={fieldLink}>
                <EditContextProvider
                  key={activeComponent.uniqueId}
                  component={activeComponent}
                  onCommit={updateComponent}
                  targetIframeRef={canvasIframeRef}
                  contentOnly={contentOnly}
                >
                  <BlockEditorPanel onDone={() => setActiveComponentId(null)} />
                  <MediaBrowser />
                </EditContextProvider>
              </FieldLinkProvider>
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
