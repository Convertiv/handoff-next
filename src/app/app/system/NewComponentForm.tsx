'use client';

import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidComponentId } from '../../lib/component-id';
import { createComponent } from '../actions/components';
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../../components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '../../components/ui/drawer';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

type RendererKind = 'react' | 'handlebars' | 'csf';

function appPathPrefix(): string {
  const raw = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const base = raw.replace(/^\/+|\/+$/g, '');
  return base ? `/${base}` : '';
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function NewComponentForm() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const canCreate = status === 'authenticated' && Boolean(session?.user) && session?.user?.role === 'admin';

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEditing, setSlugEditing] = useState(false);
  const [slugManual, setSlugManual] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [group, setGroup] = useState('Atomic Elements');
  const [renderer, setRenderer] = useState<RendererKind>('handlebars');
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

  const finishSlugEdit = () => {
    setSlugEditing(false);
  };

  const resetSlugToAuto = () => {
    setSlugManual(false);
    setSlugEditing(false);
    const auto = toSlug(title);
    setSlug(auto);
    scheduleCheck(auto);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!canCreate) return null;

  const submit = async () => {
    setErr(null);
    const finalSlug = slug.trim();
    if (!isValidComponentId(finalSlug)) {
      setErr('ID: 1–128 chars, start with a letter or number, only lowercase letters, numbers, and hyphens.');
      return;
    }
    if (slugStatus === 'taken') {
      setErr(`Component "${finalSlug}" already exists.`);
      return;
    }
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    setBusy(true);
    try {
      await createComponent({
        id: finalSlug,
        title: title.trim(),
        group: group.trim() || 'Atomic Elements',
        renderer,
      });
      fetch(handoffApiUrl('/api/handoff/components/build'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ componentId: finalSlug }),
      }).catch(() => undefined);
      setOpen(false);
      setTitle('');
      setSlug('');
      setSlugManual(false);
      setSlugEditing(false);
      setSlugStatus('idle');
      router.push(`${appPathPrefix()}/system/component/${finalSlug}/`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <DrawerTrigger asChild>
        <Button variant="default" size="sm" className="shrink-0">
          New component
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-w-md">
        <DrawerHeader>
          <DrawerTitle>New component</DrawerTitle>
          <p className="text-left text-sm font-normal text-muted-foreground">Creates a DB-backed component (dynamic mode) with scaffolded source.</p>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {err ? <p className="text-sm text-red-600">{err}</p> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="nc-title">Title</Label>
            <Input id="nc-title" value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Display name" autoComplete="off" />
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="nc-group">Group</Label>
            <Input id="nc-group" value={group} onChange={(e) => setGroup(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Renderer</Label>
            <Select value={renderer} onValueChange={(v) => setRenderer(v as RendererKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handlebars">Handlebars</SelectItem>
                <SelectItem value="react">React</SelectItem>
                <SelectItem value="csf">CSF (story)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={() => void submit()} disabled={busy || slugStatus === 'taken' || slugStatus === 'checking'}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
