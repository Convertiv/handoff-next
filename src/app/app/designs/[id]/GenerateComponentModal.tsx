'use client';

import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidComponentId } from '../../../lib/component-id';
import { handoffApiUrl } from '../../../lib/api-path';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { Textarea } from '../../../components/ui/textarea';

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string;
  hasExtractedAssets: boolean;
  onJobStarted: (jobId: number) => void;
};

export function GenerateComponentModal({ open, onOpenChange, artifactId, hasExtractedAssets, onJobStarted }: Props) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEditing, setSlugEditing] = useState(false);
  const [slugManual, setSlugManual] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [renderer, setRenderer] = useState('handlebars');
  const [behaviorPrompt, setBehaviorPrompt] = useState('');
  const [a11yStandard, setA11yStandard] = useState('none');
  const [useExtractedAssets, setUseExtractedAssets] = useState(hasExtractedAssets);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugInputRef = useRef<HTMLInputElement>(null);

  const checkSlugUniqueness = useCallback(async (value: string) => {
    if (!value || !isValidComponentId(value)) {
      setSlugStatus(value ? 'invalid' : 'idle');
      return;
    }
    setSlugStatus('checking');
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/components?id=${encodeURIComponent(value)}`), { credentials: 'include' });
      if (res.status === 404) {
        setSlugStatus('available');
      } else if (res.ok) {
        setSlugStatus('taken');
      } else {
        setSlugStatus('idle');
      }
    } catch {
      setSlugStatus('idle');
    }
  }, []);

  const scheduleCheck = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void checkSlugUniqueness(value), 350);
    },
    [checkSlugUniqueness]
  );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugManual) {
      const auto = toSlug(value);
      setSlug(auto);
      scheduleCheck(auto);
    }
  };

  const handleSlugChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 128);
    setSlug(cleaned);
    scheduleCheck(cleaned);
  };

  const startSlugEdit = () => {
    setSlugEditing(true);
    setSlugManual(true);
    requestAnimationFrame(() => slugInputRef.current?.focus());
  };

  const finishSlugEdit = () => setSlugEditing(false);

  const resetSlugToAuto = () => {
    setSlugManual(false);
    setSlugEditing(false);
    const auto = toSlug(title);
    setSlug(auto);
    scheduleCheck(auto);
  };

  useEffect(() => {
    if (open) setUseExtractedAssets(hasExtractedAssets);
  }, [open, hasExtractedAssets]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const slugStatusIcon = () => {
    switch (slugStatus) {
      case 'checking':
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />;
      case 'available':
        return <Check className="h-3.5 w-3.5 text-emerald-600" />;
      case 'taken':
        return <X className="h-3.5 w-3.5 text-red-500" />;
      default:
        return null;
    }
  };

  const slugStatusText = () => {
    switch (slugStatus) {
      case 'checking':
        return <span className="text-xs text-gray-400">Checking…</span>;
      case 'available':
        return <span className="text-xs text-emerald-600">Available</span>;
      case 'taken':
        return <span className="text-xs text-red-500">Already exists</span>;
      case 'invalid':
        return <span className="text-xs text-amber-600">Invalid slug format</span>;
      default:
        return null;
    }
  };

  const submit = async () => {
    setErr(null);
    const finalSlug = slug.trim();
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (!isValidComponentId(finalSlug)) {
      setErr('ID: 1–128 chars, start with a letter or number, only lowercase letters, numbers, and hyphens.');
      return;
    }
    if (slugStatus === 'taken') {
      setErr(`Component "${finalSlug}" already exists.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/generate-component'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId,
          componentName: finalSlug,
          componentTitle: title.trim(),
          renderer,
          behaviorPrompt: behaviorPrompt.trim(),
          a11yStandard,
          useExtractedAssets,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { jobId?: number; error?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      if (typeof json.jobId !== 'number') throw new Error('No job id returned.');
      onJobStarted(json.jobId);
      onOpenChange(false);
      setTitle('');
      setSlug('');
      setSlugManual(false);
      setSlugEditing(false);
      setSlugStatus('idle');
      setBehaviorPrompt('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to start generation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate component</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="gc-title">Title</Label>
            <Input
              id="gc-title"
              placeholder="Display name, e.g. Hero Banner"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Component ID (slug)</Label>
            {slugEditing ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    ref={slugInputRef}
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    onBlur={finishSlugEdit}
                    onKeyDown={(e) => { if (e.key === 'Enter') finishSlugEdit(); }}
                    className="pr-8 font-mono text-sm"
                    autoComplete="off"
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                    {slugStatusIcon()}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={resetSlugToAuto}>
                  Auto
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex min-h-[36px] flex-1 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-1.5 font-mono text-sm text-muted-foreground">
                  <span className="truncate">{slug || <span className="italic text-gray-400">type a title…</span>}</span>
                  <span className="ml-auto shrink-0">{slugStatusIcon()}</span>
                </div>
                <button
                  type="button"
                  onClick={startSlugEdit}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  aria-label="Edit slug"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="min-h-[18px]">{slugStatusText()}</div>
          </div>
          <div className="space-y-2">
            <Label>Template</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={renderer}
              onChange={(e) => setRenderer(e.target.value)}
            >
              <option value="handlebars">Handlebars + SCSS</option>
              <option value="react">React + TSX</option>
              <option value="csf">Storybook (CSF)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="beh">Behavior & layout notes</Label>
            <Textarea
              id="beh"
              placeholder="Interactions, responsive behavior, content model…"
              value={behaviorPrompt}
              onChange={(e) => setBehaviorPrompt(e.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Accessibility target</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={a11yStandard}
              onChange={(e) => setA11yStandard(e.target.value)}
            >
              <option value="none">None (visual match only)</option>
              <option value="wcag-aa">WCAG 2.1 AA (vision review)</option>
              <option value="wcag-aaa">WCAG 2.1 AAA (vision review)</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Use extracted assets</p>
              <p className="text-xs text-muted-foreground">Pass background / element PNGs into the model when available.</p>
            </div>
            <Switch checked={useExtractedAssets} onCheckedChange={setUseExtractedAssets} disabled={!hasExtractedAssets} />
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !slug.trim() || !title.trim() || slugStatus === 'taken' || slugStatus === 'checking'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start generation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
