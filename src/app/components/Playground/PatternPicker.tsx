'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

type PatternListEntry = PatternListObject & {
  _source?: string;
  _updatedAt?: string | null;
  _componentCount?: number;
};

export default function PatternPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (patternId: string) => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PatternListEntry[]>([]);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns?${params.toString()}`), { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { patterns: PatternListEntry[] };
      setItems(json.patterns ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,560px)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Load pattern</DialogTitle>
          <DialogDescription>Choose a saved pattern to replace the current blocks.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 gap-2 border-b px-6 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
            Go
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No patterns found.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded-md border border-transparent px-3 py-2 text-left text-sm hover:border-border hover:bg-muted/50"
                    onClick={() => {
                      void Promise.resolve(onPick(p.id)).then(() => onOpenChange(false));
                    }}
                  >
                    <span className="font-medium">{p.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {p._componentCount ?? p.components?.length ?? 0} blocks
                      {p.group ? ` · ${p.group}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
