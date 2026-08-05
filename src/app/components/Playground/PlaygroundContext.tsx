'use client';

import type { PatternComponentEntry } from '@handoff/transformers/preview/types';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useSession } from 'next-auth/react';
import { updatePattern } from '@/app/actions/patterns';
import { buildPatternPayload } from '@/lib/pattern-payload';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import { renderPreview } from './Preview';
import type { BulkComponentEntry, PlaygroundComponent, SelectedPlaygroundComponent } from './types';

interface Template {
  name: string;
  components: SelectedPlaygroundComponent[];
  created_at: string;
  updated_at: string;
}

export type { BulkComponentEntry };

interface PlaygroundContextType {
  components: PlaygroundComponent[];
  selectedComponents: SelectedPlaygroundComponent[];
  loading: boolean;
  error: string | null;
  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  /** When set, Save pattern updates this id (dynamic mode). */
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
  recoveredDraft: { count: number } | null;
  restoreRecoveredDraft: () => void;
  discardRecoveredDraft: () => void;
  templates: Template[];
  saveAsTemplate: (templateName: string) => void;
  loadTemplate: (templateName: string) => void;
  deleteTemplate: (templateName: string) => void;
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
}: {
  children: ReactNode;
  initialPatternId?: string;
}) {
  const { status } = useSession();
  /** Full Handoff server (DB-backed patterns, etc.); static export mode has been removed. */
  const isDynamicApp = true;

  const [components, setComponents] = useState<PlaygroundComponent[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<SelectedPlaygroundComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'off' | 'idle' | 'saving' | 'saved' | 'failed'>('off');
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
    setTemplates(getTemplatesFromStorage());
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

  useEffect(() => {
    if (!isDynamicApp || status !== 'authenticated' || !editingPatternId) {
      setSaveState('off');
      persistedRef.current = null;
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
          const { components, payload } = buildPatternPayload(
            editingPatternId,
            '',
            '',
            '',
            [],
            selectedComponents,
            basePath
          );
          // Title/description/group/tags are deliberately NOT sent: they are edited elsewhere, and an
          // empty string here would wipe them. Autosave owns the canvas, nothing else.
          await updatePattern(editingPatternId, { components, data: payload });
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
  }, [selectedComponents, editingPatternId, isDynamicApp, status, basePath]);

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
        setError('Sign in and use dynamic mode to load patterns from the server.');
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
    if (!initialPatternId || !isDynamicApp || status === 'loading' || status === 'unauthenticated') return;
    void loadPatternById(initialPatternId, true);
  }, [initialPatternId, isDynamicApp, status, loadPatternById]);

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

  const saveAsTemplate = useCallback(
    (templateName: string) => {
      if (isDynamicApp) {
        return;
      }
      const template: Template = {
        name: templateName,
        components: selectedComponents,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setTemplates((prev) => [...prev, template]);
      localStorage.setItem(`${TEMPLATE_PREFIX}${templateName}`, JSON.stringify(template));
    },
    [selectedComponents, isDynamicApp]
  );

  const loadTemplate = useCallback((templateName: string) => {
    const raw = localStorage.getItem(`${TEMPLATE_PREFIX}${templateName}`);
    if (raw) {
      try {
        const template = JSON.parse(raw);
        setSelectedComponents(template.components || []);
        setEditingPatternId(null);
      } catch {
        // ignore
      }
    }
  }, []);

  const deleteTemplate = useCallback((templateName: string) => {
    setTemplates((prev) => prev.filter((t) => t.name !== templateName));
    localStorage.removeItem(`${TEMPLATE_PREFIX}${templateName}`);
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
        templates,
        saveAsTemplate,
        saveState,
        recoveredDraft,
        restoreRecoveredDraft,
        discardRecoveredDraft,
        loadTemplate,
        deleteTemplate,
        isDynamicApp,
      }}
    >
      {children}
    </PlaygroundContext.Provider>
  );
}

function getTemplatesFromStorage(): Template[] {
  const templates: Template[] = [];
  if (typeof localStorage === 'undefined') return templates;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TEMPLATE_PREFIX)) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          templates.push({
            name: key.replace(TEMPLATE_PREFIX, ''),
            components: parsed.components || [],
            created_at: parsed.created_at || new Date().toISOString(),
            updated_at: parsed.updated_at || new Date().toISOString(),
          });
        }
      } catch {
        // ignore
      }
    }
  }
  return templates;
}

export function usePlayground() {
  const context = useContext(PlaygroundContext);
  if (context === undefined) {
    throw new Error('usePlayground must be used within a PlaygroundProvider');
  }
  return context;
}
