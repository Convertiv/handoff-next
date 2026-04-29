'use client';

import type { PatternComponentEntry } from '@handoff/transformers/preview/types';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useSession } from 'next-auth/react';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
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
  templates: Template[];
  saveAsTemplate: (templateName: string) => void;
  loadTemplate: (templateName: string) => void;
  deleteTemplate: (templateName: string) => void;
  isDynamicApp: boolean;
}

const STORAGE_KEY = 'handoff-playground-components';
const TEMPLATE_PREFIX = 'handoff-playground-template-';

const PlaygroundContext = createContext<PlaygroundContextType | undefined>(undefined);

const componentCache: Record<string, PlaygroundComponent> = {};

async function fetchComponentDetail(id: string, basePath: string): Promise<PlaygroundComponent> {
  if (componentCache[id]) {
    return { ...componentCache[id] };
  }

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
  const isDynamicApp = (process.env.NEXT_PUBLIC_HANDOFF_MODE ?? '') === 'dynamic';

  const [components, setComponents] = useState<PlaygroundComponent[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<SelectedPlaygroundComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);

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

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSelectedComponents(JSON.parse(saved));
      } catch {
        // ignore corrupt data
      }
    }
  }, []);

  useEffect(() => {
    if (selectedComponents.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedComponents));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedComponents]);

  const bulkAddComponents = useCallback(
    async (entries: BulkComponentEntry[], replace = true) => {
      const results: SelectedPlaygroundComponent[] = [];
      for (let i = 0; i < entries.length; i++) {
        const { componentId, data } = entries[i];
        try {
          const detail = await fetchComponentDetail(componentId, basePath);
          detail.data = { ...detail.data, ...data };
          detail.rendered = await renderPreview(detail, detail.data, basePath);
          results.push({
            ...detail,
            order: i,
            quantity: 1,
            uniqueId: `${componentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          });
        } catch (err) {
          console.warn(`Playground: skipping unknown component "${componentId}"`, err);
        }
      }
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
