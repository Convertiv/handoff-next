'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { KIND_META, type PatternKind } from '@/lib/authz/vocab';

/**
 * Name it while you still know what it is for (Brad, 2026-08-13).
 *
 * "New" used to go straight to a blank canvas, and the record it eventually saved was called `Untitled page`
 * forever — there was no title field anywhere in the app to change it with. `PageTitle` fixed the *ability* to
 * rename; this is the flow that means most things arrive already named, because the moment a person clicks
 * "New → Template" is the moment they are surest what the thing is.
 *
 * **Skippable, deliberately.** A dialog between a person and an empty canvas is friction when they are
 * exploring rather than building something they can already name. Skipping keeps the placeholder, and the
 * toolbar rename is still there.
 *
 * The name travels as a query parameter rather than creating the record here, because nothing exists yet:
 * save-on-first-block still owns creation, and this only changes what it writes for `title`.
 */
export default function NameNewRecordDialog({
  kind,
  open,
  onOpenChange,
  basePath = '',
}: {
  /** Which of the two is being made. Only the words differ; the canvas is the same tool. */
  kind: PatternKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const noun = KIND_META[kind].label.toLowerCase();

  // A dialog reopened should not still hold the last thing typed into it.
  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const go = (withName: boolean) => {
    const params = new URLSearchParams();
    if (kind === 'template') params.set('kind', 'template');
    const trimmed = name.trim();
    if (withName && trimmed) params.set('name', trimmed);
    const query = params.toString();
    onOpenChange(false);
    router.push(`${basePath}/playground${query ? `?${query}` : ''}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Name this {noun}</DialogTitle>
          <DialogDescription>
            {kind === 'template'
              ? 'Whoever you share this with will see the name, so make it one they would recognise.'
              : 'You can change this later from the toolbar.'}
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(true);
            }
          }}
          placeholder={kind === 'template' ? 'Product landing page' : 'Pricing'}
          aria-label={`${KIND_META[kind].label} name`}
        />

        <DialogFooter className="gap-2 sm:gap-2">
          {/* Skip is a real option, not a punishment — it opens the same canvas, just unnamed. */}
          <Button type="button" variant="ghost" onClick={() => go(false)}>
            Skip
          </Button>
          <Button type="button" onClick={() => go(true)} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
