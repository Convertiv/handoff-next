'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { Info, Loader2, Search } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPatternMeta } from '@/app/actions/patterns';
import {
  AssetInspector,
  LaneTabs,
  LifecycleBadge,
  OwnerAttribution,
  VisibilityBadge,
} from '@/components/library';
import type { Lane, Lifecycle, ResourcePermissions, Visibility } from '@/lib/authz/vocab';
import { handoffApiUrl, handoffBasePath } from '@/lib/api-path';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

type Owner = { id: string; name?: string | null; image?: string | null } | null;

type PatternListEntry = PatternListObject & {
  _source?: string;
  _thumbnail?: string | null;
  _userId?: string | null;
  _updatedAt?: string | null;
  _componentCount?: number;
  visibility: string;
  status: string;
  permissions: ResourcePermissions | null;
  owner: Owner;
  isMe: boolean;
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
  const [lane, setLane] = useState<Lane>('yours');
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Share tokens minted this session, keyed by pattern id.
  const [shareTokens, setShareTokens] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('lane', lane);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns?${params.toString()}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { patterns: PatternListEntry[] };
      setItems(json.patterns ?? []);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Could not load patterns.');
    } finally {
      setLoading(false);
    }
  }, [q, lane]);

  // `load` depends on lane + q, so this re-fires whenever either changes while open.
  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const selected = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  const shareUrl = useMemo(() => {
    if (!selectedId) return null;
    const token = shareTokens[selectedId];
    if (!token) return null;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Human-friendly public viewer page (base-path aware), not the JSON endpoint.
    return `${origin}${handoffBasePath()}/s/${token}`;
  }, [selectedId, shareTokens]);

  // Fetch any EXISTING share link when the inspector opens so a link minted in a
  // previous session still shows. Deduped per id; 403 (non-owner) fails quietly.
  const checkedShareRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!inspectorOpen || !selectedId) return;
    const id = selectedId;
    if (shareTokens[id] || checkedShareRef.current.has(id)) return;
    checkedShareRef.current.add(id);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          handoffApiUrl(`/api/handoff/share?resourceType=pattern&resourceId=${encodeURIComponent(id)}`),
          { credentials: 'include' },
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { token?: string | null };
        if (cancelled || !json.token) return;
        setShareTokens((prev) => (prev[id] ? prev : { ...prev, [id]: json.token as string }));
      } catch {
        /* quiet — no existing link surfaced */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectorOpen, selectedId, shareTokens]);

  const handlePick = useCallback(
    (id: string) => {
      void Promise.resolve(onPick(id)).then(() => onOpenChange(false));
    },
    [onPick, onOpenChange],
  );

  const openDetails = (id: string) => {
    setSelectedId(id);
    setInspectorOpen(true);
  };

  const setMeta = async (meta: { visibility?: Visibility; status?: Lifecycle }) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await setPatternMeta(selectedId, meta);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update pattern.');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${selectedId}/clone`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { id?: string };
      await load();
      if (json.id) setSelectedId(json.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate pattern.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShare = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/share'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resourceType: 'pattern', resourceId: selectedId }),
      });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not create share link.');
      setShareTokens((prev) => ({ ...prev, [selectedId]: json.token as string }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create share link.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!selectedId) return;
    const token = shareTokens[selectedId];
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        handoffApiUrl(`/api/handoff/share?token=${encodeURIComponent(token)}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await res.text());
      setShareTokens((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke share link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,720px)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Pattern library</DialogTitle>
          <DialogDescription>Browse saved patterns and load one into the playground.</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-3">
          <LaneTabs value={lane} onChange={setLane} />
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load();
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
            Go
          </Button>
        </div>

        {error ? (
          <div className="flex shrink-0 items-center gap-2 border-b bg-destructive/5 px-6 py-2 text-sm text-destructive">
            <Info className="h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No patterns found in this lane.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => {
                const blocks = p._componentCount ?? p.components?.length ?? 0;
                return (
                  <li key={p.id} className="group flex flex-col overflow-hidden rounded-lg border bg-card">
                    <button
                      type="button"
                      className="relative block aspect-video w-full overflow-hidden bg-muted/30 text-left"
                      onClick={() => handlePick(p.id)}
                      title="Load into playground"
                    >
                      {p._thumbnail ? (
                        <Image
                          src={p._thumbnail}
                          alt={p.title}
                          width={512}
                          height={288}
                          unoptimized
                          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          No preview
                        </span>
                      )}
                    </button>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <button
                        type="button"
                        className="text-left text-sm font-medium leading-tight hover:underline"
                        onClick={() => handlePick(p.id)}
                      >
                        {p.title}
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <LifecycleBadge status={p.status as Lifecycle} />
                        <VisibilityBadge visibility={p.visibility as Visibility} />
                      </div>
                      <OwnerAttribution owner={p.owner} isMe={p.isMe} />
                      <div className="mt-auto flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">
                          {blocks} blocks{p.group ? ` · ${p.group}` : ''}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openDetails(p.id)}
                        >
                          Details
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>

      <AssetInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        asset={
          selected
            ? {
                id: selected.id,
                title: selected.title,
                thumbnailUrl: selected._thumbnail ?? null,
                owner: selected.owner,
                isMe: selected.isMe,
                visibility: selected.visibility as Visibility,
                status: selected.status as Lifecycle,
                surface: 'pattern',
              }
            : null
        }
        permissions={selected?.permissions ?? null}
        busy={busy}
        onSetLifecycle={(s) => void setMeta({ status: s })}
        onSetVisibility={(v) => void setMeta({ visibility: v })}
        onOpen={() => selectedId && handlePick(selectedId)}
        onDuplicate={() => void handleDuplicate()}
        shareUrl={shareUrl}
        onCreateShare={() => void handleCreateShare()}
        onRevokeShare={() => void handleRevokeShare()}
      />
    </Dialog>
  );
}
