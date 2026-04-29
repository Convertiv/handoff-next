'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { FileOutput, ListIcon, Loader2, TrashIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { deletePattern } from '@/app/actions/patterns';
import { handoffApiUrl } from '@/lib/api-path';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { usePlayground } from './PlaygroundContext';

type RemotePattern = PatternListObject & {
  _source?: string;
  _updatedAt?: string | null;
};

export default function TemplateManager() {
  const { templates, deleteTemplate, loadTemplate, loadPatternById, isDynamicApp } = usePlayground();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<RemotePattern[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const fetchRemote = useCallback(async () => {
    if (!isDynamicApp || status !== 'authenticated') {
      setRemote([]);
      return;
    }
    setLoadingRemote(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/patterns'), { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { patterns: RemotePattern[] };
      setRemote(json.patterns ?? []);
    } catch {
      setRemote([]);
    } finally {
      setLoadingRemote(false);
    }
  }, [isDynamicApp, status]);

  useEffect(() => {
    if (open && isDynamicApp) void fetchRemote();
  }, [open, isDynamicApp, fetchRemote]);

  const handleDelete = (templateName: string) => {
    if (confirm(`Delete template "${templateName}"?`)) {
      deleteTemplate(templateName);
    }
  };

  const handleDeleteRemote = async (id: string, title: string) => {
    if (!confirm(`Delete pattern "${title}"?`)) return;
    try {
      await deletePattern(id);
      await fetchRemote();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const showLocal = !isDynamicApp && templates.length > 0;
  const showRemote = isDynamicApp && status === 'authenticated';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ListIcon className="h-4 w-4" />
          Templates
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="max-w-[400px] overflow-y-auto sm:max-w-[30vw]">
        <SheetHeader>
          <SheetTitle>Saved layouts</SheetTitle>
          <SheetDescription>
            {isDynamicApp ? 'Patterns from the database and local browser templates.' : 'Local templates stored in this browser.'}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {showRemote && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server patterns</h3>
              {loadingRemote ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : remote.length === 0 ? (
                <p className="text-sm text-muted-foreground">No patterns yet. Save from the Playground toolbar.</p>
              ) : (
                <div className="space-y-2">
                  {remote.map((p) => (
                    <div key={p.id} className="flex flex-col gap-2 rounded border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Load"
                            onClick={() => {
                              if (confirm('Load this pattern? This replaces your current blocks.')) {
                                void loadPatternById(p.id, true).then(() => setOpen(false));
                              }
                            }}
                          >
                            <FileOutput className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => void handleDeleteRemote(p.id, p.title)}>
                            <TrashIcon className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.components?.length ?? 0} blocks
                        {p._source ? ` · ${p._source}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showLocal && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Local templates</h3>
              <div className="space-y-4">
                {templates.map((template) => (
                  <div key={template.name} className="flex flex-col gap-2 rounded border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {template.name}
                        <span className="pl-2 text-xs text-muted-foreground">{new Date(template.created_at).toLocaleDateString()}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm('Load this template? This will replace your current components.')) {
                              loadTemplate(template.name);
                              setOpen(false);
                            }
                          }}
                          title="Load template"
                        >
                          <FileOutput className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(template.name)} title="Delete template">
                          <TrashIcon className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <details>
                      <summary className="mt-1 cursor-pointer text-sm text-muted-foreground hover:underline">
                        Components ({template.components.length})
                      </summary>
                      <ul className="ml-4 mt-2 list-disc space-y-1 text-xs text-muted-foreground">
                        {template.components.length === 0 ? (
                          <li>No components in this template.</li>
                        ) : (
                          template.components.map((comp, idx) => (
                            <li key={comp.uniqueId || `${comp.id}-${idx}`}>{comp.title || `Component ${idx + 1}`}</li>
                          ))
                        )}
                      </ul>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!showLocal && !showRemote && <p className="text-sm text-muted-foreground">No saved layouts.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
