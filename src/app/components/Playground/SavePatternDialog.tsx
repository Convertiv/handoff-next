'use client';

import type { PatternComponentEntry, PatternListObject } from '@handoff/transformers/preview/types';
import { useCallback, useEffect, useState } from 'react';
import { createPattern, updatePattern } from '@/app/actions/patterns';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import type { BulkComponentEntry, SelectedPlaygroundComponent } from './types';

function slugFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'pattern';
}

function newPatternId(title: string): string {
  const slug = slugFromTitle(title);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `pattern-${slug}-${suffix}`;
}

function buildPatternPayload(
  id: string,
  title: string,
  description: string,
  group: string,
  tags: string[],
  selected: SelectedPlaygroundComponent[],
  basePath: string
): { list: PatternListObject; components: PatternComponentEntry[]; payload: Record<string, unknown> } {
  const components: PatternComponentEntry[] = selected.map((c) => {
    const previewKeys = Object.keys(c.previews || {});
    const previewKey = c.previews?.generic ? 'generic' : previewKeys[0];
    return {
      id: c.id,
      ...(previewKey ? { preview: previewKey } : {}),
      args: { ...(c.data ?? {}) },
    };
  });

  const previews = {
    default: {
      title: 'Default',
      values: selected.map((c) => ({ ...(c.data ?? {}) })),
    },
  };

  const list: PatternListObject = {
    id,
    path: `${basePath}/api/pattern/${id}.json`,
    title,
    description: description || undefined,
    group: group || undefined,
    tags: tags.length ? tags : undefined,
    components,
    url: `${id}.html`,
  };

  const payload: Record<string, unknown> = { ...list, previews };
  return { list, components, payload };
}

function buildPatternPayloadFromBulk(
  id: string,
  title: string,
  description: string,
  group: string,
  tags: string[],
  entries: BulkComponentEntry[],
  basePath: string
): { list: PatternListObject; components: PatternComponentEntry[]; payload: Record<string, unknown> } {
  const components: PatternComponentEntry[] = entries.map((e) => ({
    id: e.componentId,
    args: { ...(e.data ?? {}) },
  }));
  const previews = {
    default: {
      title: 'Default',
      values: entries.map((e) => ({ ...(e.data ?? {}) })),
    },
  };
  const list: PatternListObject = {
    id,
    path: `${basePath}/api/pattern/${id}.json`,
    title,
    description: description || undefined,
    group: group || undefined,
    tags: tags.length ? tags : undefined,
    components,
    url: `${id}.html`,
  };
  const payload: Record<string, unknown> = { ...list, previews };
  return { list, components, payload };
}

type SavePatternDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current playground blocks (when saving the canvas). */
  selectedComponents?: SelectedPlaygroundComponent[];
  /** AI wizard or other flows without full component rows. */
  draftBulkEntries?: BulkComponentEntry[] | null;
  /** When set, Save updates this pattern id. */
  editingPatternId?: string | null;
  onSaved?: (id: string) => void;
};

export default function SavePatternDialog({
  open,
  onOpenChange,
  selectedComponents = [],
  draftBulkEntries = null,
  editingPatternId,
  onSaved,
}: SavePatternDialogProps) {
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const [title, setTitle] = useState('Playground pattern');
  const [description, setDescription] = useState('');
  const [group, setGroup] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      if (!editingPatternId) {
        setTitle('Playground pattern');
        setDescription('');
        setGroup('');
        setTagsRaw('');
      }
    }
  }, [open, editingPatternId]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    const blocks =
      draftBulkEntries && draftBulkEntries.length > 0 ? draftBulkEntries : null;
    const fromCanvas = !blocks && selectedComponents.length > 0 ? selectedComponents : null;
    if (!blocks && !fromCanvas) {
      setError('Add at least one block before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const id = editingPatternId ?? newPatternId(title);
      const { components, payload } = blocks
        ? buildPatternPayloadFromBulk(
            id,
            title.trim(),
            description.trim(),
            group.trim(),
            tags,
            blocks,
            basePath
          )
        : buildPatternPayload(
            id,
            title.trim(),
            description.trim(),
            group.trim(),
            tags,
            fromCanvas!,
            basePath
          );

      if (editingPatternId) {
        await updatePattern(editingPatternId, {
          title: title.trim(),
          description: description.trim(),
          group: group.trim(),
          tags,
          components,
          data: payload,
        });
      } else {
        await createPattern({
          id,
          title: title.trim(),
          description: description.trim(),
          group: group.trim(),
          tags,
          components,
          payload,
          source: 'playground',
        });
      }
      onSaved?.(editingPatternId ?? id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    group,
    tagsRaw,
    selectedComponents,
    draftBulkEntries,
    editingPatternId,
    basePath,
    onOpenChange,
    onSaved,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingPatternId ? 'Update pattern' : 'Save pattern'}</DialogTitle>
          <DialogDescription>
            Store this layout in the database{editingPatternId ? '' : ' with a new id'}. You can open it later from Patterns or
            Load pattern in the Playground.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="pat-title">Title</Label>
            <Input id="pat-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pat-desc">Description</Label>
            <Textarea id="pat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pat-group">Group</Label>
            <Input id="pat-group" placeholder="Marketing, Landing, …" value={group} onChange={(e) => setGroup(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pat-tags">Tags (comma-separated)</Label>
            <Input id="pat-tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : editingPatternId ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
