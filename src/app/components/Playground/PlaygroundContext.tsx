'use client';

import type { PatternComponentEntry } from '@handoff/transformers/preview/types';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { createPattern, updatePattern } from '@/app/actions/patterns';
import { buildPatternPayload } from '@/lib/pattern-payload';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import { renderPreview } from './Preview';
import type { BulkComponentEntry, PlaygroundComponent, SelectedPlaygroundComponent } from './types';

export type { BulkComponentEntry };

/**
 * How a surface loads and saves the canvas (roadmap E.5).
 *
 * The editor used to hardcode the authenticated path — session-gated, pattern detail endpoint, `updatePattern`
 * server action. A guest filling in a template needs the identical lifecycle against the guest endpoints, and
 * building a *second* editor for them is how the two drift (which is exactly what the hand-rolled fields-only
 * guest form was). So persistence is injected and everything above it is shared.
 *
 * Omit it and the authenticated behaviour applies unchanged.
 */
export interface PlaygroundPersistence {
  /** Blocks + per-block override values for the record this surface owns. Null if there is nothing yet. */
  hydrate: () => Promise<{ components: PatternComponentEntry[]; values: Record<string, unknown>[] } | null>;
  /** Save the canvas. Throwing marks the save failed; the canvas keeps the work either way. */
  persist: (blocks: SelectedPlaygroundComponent[]) => Promise<void>;
}

interface PlaygroundContextType {
  components: PlaygroundComponent[];
  selectedComponents: SelectedPlaygroundComponent[];
  loading: boolean;
  error: string | null;
  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  /** The record this canvas is; autosave writes to it (dynamic mode). Null until the first block. */
  editingPatternId: string | null;
  setEditingPatternId: (id: string | null) => void;
  addComponent: (component: PlaygroundComponent) => void;
  bulkAddComponents: (entries: BulkComponentEntry[], replace?: boolean) => Promise<void>;
  loadPatternById: (patternId: string, replace?: boolean) => Promise<void>;
  removeComponent: (uniqueId: string) => void;
  updateComponent: (component: SelectedPlaygroundComponent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /**
   * A canvas found in local storage from a previous visit, **not** applied. Roadmap E.3: silently
   * rehydrating is what made "New" load old work. Offered for recovery instead, then cleared either way.
   */
  /**
   * Autosave state for a page opened by id. `off` means there is no record to write to yet — a brand new
   * canvas — which is the one case where the old explicit save still matters (roadmap E.2 removes it).
   */
  saveState: 'off' | 'idle' | 'saving' | 'saved' | 'failed';
  /** True when the open record is a frozen template: read-only, clone to edit. */
  isTemplate: boolean;
  /**
   * Whether the *structure* of the page may change — add, remove, reorder blocks. False for a guest filling
   * in a template and for a frozen template being viewed (roadmap E.5). Content editing is unaffected: the
   * point is one editor with one capability switch, not a second editor.
   */
  structuralEditing: boolean;
  /**
   * Whether the AI builder is offered. False for guests: every endpoint it calls requires a session, so the
   * control would be an invitation to a 401.
   */
  aiAssistantEnabled: boolean;
  /** Copy this template into a new editable page and go there. Resolves to the new page id. */
  cloneToNewPage: () => Promise<string | null>;
  recoveredDraft: { count: number } | null;
  restoreRecoveredDraft: () => void;
  discardRecoveredDraft: () => void;
  isDynamicApp: boolean;
}

const STORAGE_KEY = 'handoff-playground-components';
/** Generous on purpose: a save is a full pattern replace plus an audit row, and edits arrive in bursts. */
const AUTOSAVE_DEBOUNCE_MS = 2000;
const TEMPLATE_PREFIX = 'handoff-playground-template-';

const PlaygroundContext = createContext<PlaygroundContextType | undefined>(undefined);

const componentCache: Record<string, PlaygroundComponent> = {};
// Dedupe concurrent fetches of the same id (e.g. a pattern that repeats a
// component) so a parallel bulk load issues one network request per unique id.
const inFlightFetches: Record<string, Promise<PlaygroundComponent>> = {};

async function fetchComponentDetail(id: string, basePath: string): Promise<PlaygroundComponent> {
  if (componentCache[id]) {
    return { ...componentCache[id] };
  }

  if (!inFlightFetches[id]) {
    inFlightFetches[id] = (async () => {
      const response = await fetch(`${basePath}/api/component/${id}.json`);
      if (!response.ok) {
        throw new Error(`Failed to fetch component: ${response.statusText}`);
      }

      const component = await response.json();
      if (component.previews?.generic) {
        component.data = component.previews.generic.values;
      } else {
        const firstPreview = Object.values(component.previews)[0];
        if (firstPreview) {
          component.data = (firstPreview as { values: Record<string, any> }).values;
        } else {
          component.data = {};
        }
      }

      delete component.jsCompiled;
      delete component.css;
      delete component.js;
      delete component.entries;
      delete component.options;
      delete component.sass;

      componentCache[id] = component;
      return component as PlaygroundComponent;
    })().finally(() => {
      delete inFlightFetches[id];
    });
  }

  const component = await inFlightFetches[id];
  // Return a fresh shallow copy so per-caller mutations (data / rendered) never
  // clobber the shared cached object.
  return { ...component };
}

export function PlaygroundProvider({
  children,
  initialPatternId,
  initialIsTemplate = false,
  structuralEditing: structuralEditingProp,
  persistence,
  aiAssistantEnabled = true,
}: {
  children: ReactNode;
  initialPatternId?: string;
  initialIsTemplate?: boolean;
  /** Defaults to "allowed, unless this is a frozen template". */
  structuralEditing?: boolean;
  /** Injected by surfaces that are not the authenticated playground — see `PlaygroundPersistence`. */
  persistence?: PlaygroundPersistence;
  aiAssistantEnabled?: boolean;
}) {
  const { status } = useSession();
  /** Full Handoff server (DB-backed patterns, etc.); static export mode has been removed. */
  const isDynamicApp = true;

  const [components, setComponents] = useState<PlaygroundComponent[]>([]);
  const router = useRouter();
  const [selectedComponents, setSelectedComponents] = useState<SelectedPlaygroundComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'off' | 'idle' | 'saving' | 'saved' | 'failed'>('off');
  /**
   * A template is frozen (`savePageAsTemplate`), so this canvas is a **view**. Known from the server on
   * first render, because discovering it from a refused save is how you get an editor that looks editable
   * and silently isn't.
   */
  const [isTemplate] = useState(initialIsTemplate);
  // A template is never structurally editable; otherwise the surface decides.
  const structuralEditing = isTemplate ? false : (structuralEditingProp ?? true);
  const [recoveredDraft, setRecoveredDraft] = useState<{ count: number } | null>(null);
  /** Held outside state: it is data to restore on request, not something the canvas renders. */
  const recoveredRef = useRef<SelectedPlaygroundComponent[] | null>(null);

  const basePath = typeof process !== 'undefined' ? process.env.HANDOFF_APP_BASE_PATH ?? '' : '';

  useEffect(() => {
    const loadComponents = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${basePath}/api/components.json`);
        if (!response.ok) {
          setError(`Components unavailable (${response.status})`);
          return;
        }
        const fetched: PlaygroundComponent[] = await response.json();
        setComponents(fetched);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load components');
      } finally {
        setLoading(false);
      }
    };

    loadComponents();
    purgeRetiredLocalTemplates();
  }, [basePath]);

  /**
   * Local storage is read **once, into a recovery offer** — never applied to the canvas.
   *
   * The old behaviour restored it automatically, which meant clicking "New" reopened whatever was last on
   * screen, and there was no way to get a blank canvas. Deleting the key outright would have thrown away
   * unsaved work on the deploy that shipped it, so the draft is surfaced and the user decides. Either
   * choice clears the key, so the offer appears at most once.
   *
   * A page opened by id skips the offer entirely: the record is the truth there, and a stale local canvas
   * must never be mistaken for it.
   */
  useEffect(() => {
    if (initialPatternId) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        recoveredRef.current = parsed as SelectedPlaygroundComponent[];
        setRecoveredDraft({ count: parsed.length });
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Corrupt data is not recoverable and not worth offering.
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [initialPatternId]);

  useEffect(() => {
    if (selectedComponents.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedComponents));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedComponents]);

  /**
   * "Use this template" — clone it into a new page and open that.
   *
   * Reuses the existing `/clone` route, which already copies blocks + values and (since E.2) stamps
   * `template_id` on the copy, so an editor-made page is diffable against its template exactly like a
   * guest submission.
   */
  const cloneToNewPage = useCallback(async (): Promise<string | null> => {
    if (!editingPatternId) return null;
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(editingPatternId)}/clone`), {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as { id?: string; pattern?: { id?: string }; error?: string };
      const newId = json.id ?? json.pattern?.id ?? null;
      if (!res.ok || !newId) throw new Error(json.error || 'Could not create a page from this template.');
      router.push(`${basePath}/playground/${newId}`);
      return newId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a page from this template.');
      return null;
    }
  }, [editingPatternId, router, basePath]);

  const restoreRecoveredDraft = useCallback(() => {
    const draft = recoveredRef.current;
    recoveredRef.current = null;
    setRecoveredDraft(null);
    // Cleared before applying: restoring is a one-time recovery, and the canvas write below re-persists it.
    localStorage.removeItem(STORAGE_KEY);
    if (draft?.length) setSelectedComponents(draft);
  }, []);

  const discardRecoveredDraft = useCallback(() => {
    recoveredRef.current = null;
    setRecoveredDraft(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);


  /* ------------------------------------------------------------------ autosave -- */

  /**
   * Autosave a page that has a record (roadmap E.3): a saved page is a document, not something you
   * remember to export.
   *
   * Only runs once `editingPatternId` is set — i.e. the page was opened by id or has been saved once.
   * A brand-new canvas has nothing to write to, so `saveState` stays `off` and the explicit save is still
   * the way to create the record; E.2 replaces that with save-on-first-edit.
   *
   * Three details that matter:
   * - The first render after a load must not write. `loadPatternById` sets the canvas *and* the id, so
   *   without a baseline the load itself would immediately save what it just read.
   * - The debounce is generous (2s) because a write is a full pattern replace plus an audit row, and
   *   block edits arrive in bursts while someone drags or types.
   * - A failed save leaves `failed` on screen rather than retrying silently; the canvas still holds the
   *   work, and a user who sees "not saved" can act, where a silent retry loop cannot tell them anything.
   */
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Serialized canvas last known to be persisted — the baseline that stops a load from saving itself. */
  const persistedRef = useRef<string | null>(null);
  /** Guards the create-on-first-block path so a burst of edits cannot mint two pages. */
  const creatingRef = useRef(false);

  useEffect(() => {
    /**
     * An injected adapter is its own authorization: a guest has no session but does have a signed cookie and
     * a record to write to. Only the built-in (authenticated) path needs the session check.
     */
    const canPersist = persistence ? true : isDynamicApp && status === 'authenticated';
    if (!canPersist) {
      setSaveState('off');
      persistedRef.current = null;
      return;
    }

    /**
     * Never autosave a template. The write core refuses it anyway, so attempting one would only produce a
     * "Not saved" flicker on a canvas that is behaving exactly as intended.
     */
    if (isTemplate) {
      setSaveState('off');
      return;
    }

    /**
     * **Save on first block** (roadmap E.2): a page with no record gets one as soon as it has content, and
     * the URL becomes `/playground/{id}`. There is no save button to find and no unsaved state to lose.
     *
     * Guarded by a ref rather than state so two quick edits cannot race into two records — the first
     * block creates exactly one page.
     */
    if (!editingPatternId && !persistence) {
      if (!selectedComponents.length || creatingRef.current) {
        setSaveState('off');
        return;
      }
      creatingRef.current = true;
      setSaveState('saving');
      void (async () => {
        try {
          const id = `page-${crypto.randomUUID().slice(0, 8)}`;
          const title = 'Untitled page';
          const { components, payload } = buildPatternPayload(id, title, '', '', [], selectedComponents, basePath);
          await createPattern({ id, title, components, payload, source: 'playground' });
          persistedRef.current = JSON.stringify(selectedComponents);
          setEditingPatternId(id);
          setSaveState('saved');
          // Replace, not push: the blank canvas is not a step anyone wants to go "back" to.
          router.replace(`${basePath}/playground/${id}`);
        } catch (e) {
          console.error('[playground] could not create the page', e);
          setSaveState('failed');
          // Left true on failure would strand the canvas with no record and no retry.
          creatingRef.current = false;
        }
      })();
      return;
    }

    // With an adapter the record is whatever the adapter owns, so there is no id to wait for.
    if (persistence && !selectedComponents.length) {
      setSaveState('off');
      return;
    }

    const snapshot = JSON.stringify(selectedComponents);
    if (persistedRef.current === null) {
      // First observation for this record: treat what is on screen as already saved.
      persistedRef.current = snapshot;
      setSaveState('saved');
      return;
    }
    if (persistedRef.current === snapshot) return;

    setSaveState('idle');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void (async () => {
        setSaveState('saving');
        try {
          if (persistence) {
            await persistence.persist(selectedComponents);
          } else {
            const { components, payload } = buildPatternPayload(
              editingPatternId!,
              '',
              '',
              '',
              [],
              selectedComponents,
              basePath
            );
            // Title/description/group/tags are deliberately NOT sent: they are edited elsewhere, and an
            // empty string here would wipe them. Autosave owns the canvas, nothing else.
            await updatePattern(editingPatternId!, { components, data: payload });
          }
          persistedRef.current = snapshot;
          setSaveState('saved');
        } catch (e) {
          console.error('[playground] autosave failed', e);
          setSaveState('failed');
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [selectedComponents, editingPatternId, isDynamicApp, status, basePath, router, isTemplate, persistence]);

  const bulkAddComponents = useCallback(
    async (entries: BulkComponentEntry[], replace = true) => {
      // Fan out fetch+render per component in parallel. Promise.all preserves
      // array order regardless of completion order, so the assembled layout
      // matches the pattern's original ordering. A single failing component
      // resolves to null (logged) instead of aborting the whole load.
      const settled = await Promise.all(
        entries.map(async (entry, i): Promise<SelectedPlaygroundComponent | null> => {
          const { componentId, data } = entry;
          try {
            const detail = await fetchComponentDetail(componentId, basePath);
            detail.data = { ...detail.data, ...data };
            detail.rendered = await renderPreview(detail, detail.data, basePath);
            return {
              ...detail,
              order: i,
              quantity: 1,
              uniqueId: `${componentId}-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
            };
          } catch (err) {
            console.warn(`Playground: skipping unknown component "${componentId}"`, err);
            return null;
          }
        })
      );
      const results = settled.filter((r): r is SelectedPlaygroundComponent => r !== null);
      if (replace) {
        setSelectedComponents(results);
      } else {
        setSelectedComponents((prev) => {
          const merged = [...prev, ...results];
          return merged.map((c, idx) => ({ ...c, order: idx }));
        });
      }
    },
    [basePath]
  );

  const loadPatternById = useCallback(
    async (patternId: string, replace = true) => {
      if (!isDynamicApp || status !== 'authenticated') {
        setError('Sign in and use dynamic mode to load pages from the server.');
        return;
      }
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(patternId)}`), {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`Pattern not found (${res.status})`);
        }
        const json = (await res.json()) as {
          pattern: {
            components: PatternComponentEntry[];
            data?: { previews?: { default?: { values?: Record<string, unknown>[] } } };
          };
        };
        const p = json.pattern;
        const comps = p.components ?? [];
        const values = p.data?.previews?.default?.values;
        const entries: BulkComponentEntry[] = comps.map((c, i) => ({
          componentId: c.id,
          data: {
            ...(typeof c.args === 'object' && c.args !== null ? c.args : {}),
            ...(Array.isArray(values) && values[i] && typeof values[i] === 'object' ? values[i] : {}),
          } as Record<string, any>,
        }));
        await bulkAddComponents(entries, replace);
        setEditingPatternId(patternId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load pattern';
        console.warn(msg);
        if (typeof window !== 'undefined') window.alert(msg);
      }
    },
    [basePath, bulkAddComponents, isDynamicApp, status]
  );

  useEffect(() => {
    /**
     * With an adapter the surface owns loading: a guest hydrates from the guest endpoint, which needs no
     * session and no pattern id in the URL. Same merge as `loadPatternById` — template args underneath, the
     * override layer on top — so the canvas is identical either way.
     */
    if (persistence) {
      void (async () => {
        try {
          const loaded = await persistence.hydrate();
          if (!loaded) return;
          const entries: BulkComponentEntry[] = loaded.components.map((c, i) => ({
            componentId: c.id,
            data: {
              ...(typeof c.args === 'object' && c.args !== null ? c.args : {}),
              ...(loaded.values[i] && typeof loaded.values[i] === 'object' ? loaded.values[i] : {}),
            } as Record<string, any>,
          }));
          await bulkAddComponents(entries, true);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not load this page.');
        }
      })();
      return;
    }
    if (!initialPatternId || !isDynamicApp || status === 'loading' || status === 'unauthenticated') return;
    void loadPatternById(initialPatternId, true);
  }, [initialPatternId, isDynamicApp, status, loadPatternById, persistence, bulkAddComponents]);

  const addComponent = useCallback(
    async (component: PlaygroundComponent) => {
      const detail = await fetchComponentDetail(component.id, basePath);
      detail.rendered = await renderPreview(detail, null, basePath);
      setSelectedComponents((prev) => [
        ...prev,
        {
          ...detail,
          order: prev.length,
          quantity: 1,
          uniqueId: `${component.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      ]);
      setEditingPatternId(null);
    },
    [basePath]
  );

  const removeComponent = useCallback((uniqueId: string) => {
    setSelectedComponents((prev) => prev.filter((c) => c.uniqueId !== uniqueId));
    setActiveComponentId((prev) => (prev === uniqueId ? null : prev));
  }, []);

  const updateComponent = useCallback((component: SelectedPlaygroundComponent) => {
    setSelectedComponents((prev) => prev.map((c) => (c.uniqueId === component.uniqueId ? component : c)));
  }, []);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setSelectedComponents((items) => {
        const oldIndex = items.findIndex((item) => item.uniqueId === active.id);
        const newIndex = items.findIndex((item) => item.uniqueId === over?.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        return newItems.map((item, index) => ({ ...item, order: index }));
      });
    }
  }, []);

  return (
    <PlaygroundContext.Provider
      value={{
        components,
        selectedComponents,
        loading,
        error,
        activeComponentId,
        setActiveComponentId,
        editingPatternId,
        setEditingPatternId,
        addComponent,
        bulkAddComponents,
        loadPatternById,
        removeComponent,
        updateComponent,
        onDragEnd,
        saveState,
        isTemplate,
        structuralEditing,
        aiAssistantEnabled,
        cloneToNewPage,
        recoveredDraft,
        restoreRecoveredDraft,
        discardRecoveredDraft,
        isDynamicApp,
      }}
    >
      {children}
    </PlaygroundContext.Provider>
  );
}

/**
 * One-time cleanup for the retired browser-local "templates" feature (roadmap E.2d).
 *
 * That feature stored canvases under `handoff-playground-template-*` in a single browser — invisible to
 * sharing, review, and every other machine — and it now collides with real templates
 * (`savePageAsTemplate`). It is gone, and its keys go with it rather than lingering in people's browsers
 * forever.
 *
 * Accepting the data loss is a deliberate call (Brad, 2026-08-05) on the grounds that creating one was
 * already impossible: `saveAsTemplate` returned early whenever `isDynamicApp`, which has been hardcoded
 * true since static export mode was removed. Only a pre-removal build could have written one.
 */
function purgeRetiredLocalTemplates(): void {
  if (typeof localStorage === 'undefined') return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(TEMPLATE_PREFIX)) stale.push(key);
  }
  // Collected first: removing while iterating shifts the indices underneath the loop.
  for (const key of stale) localStorage.removeItem(key);
}

export function usePlayground() {
  const context = useContext(PlaygroundContext);
  if (context === undefined) {
    throw new Error('usePlayground must be used within a PlaygroundProvider');
  }
  return context;
}
