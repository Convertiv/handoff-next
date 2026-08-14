'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { isPlaceholderTitle } from '@/lib/page-title';
import { usePlayground } from './PlaygroundContext';

/**
 * The record's name, editable where the record is.
 *
 * **This was missing entirely.** Save-on-first-block (roadmap E.2) removed the save dialog, and the reflow's
 * R.2 wizard swap orphaned `WizardDialog` — which had been the dialog's last mount point. Between them they
 * took the only title field in the app with them, so every page and template created after that was born
 * "Untitled page" and stayed that way: autosave deliberately never writes the title, and `MetaControl` only
 * covers visibility, lifecycle and kind. A library of identically-named cards is the symptom (Brad,
 * 2026-08-13).
 *
 * Click-to-edit rather than a permanent input, because the title is read far more often than it is changed and
 * a text box in the toolbar reads as "something you must fill in".
 */
export default function PageTitle() {
  const { pageTitle, setPageTitle, isTemplate } = usePlayground();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pageTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed whenever the stored name changes under us — a rename elsewhere, or the record being created.
  useEffect(() => {
    if (!editing) setDraft(pageTitle);
  }, [pageTitle, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  /**
   * Shown **before** the record exists too (Brad, 2026-08-13).
   *
   * Gating on `editingPatternId` meant the one screen where a person is most obviously making a new thing —
   * the blank canvas — was the one screen with no name on it. The context holds the name locally until
   * save-on-first-block writes it, so typing here works with nothing saved yet.
   *
   * A frozen legacy template still opts out: it would refuse the write.
   */
  if (isTemplate) return null;

  const commit = () => {
    setEditing(false);
    setPageTitle(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(pageTitle);
            setEditing(false);
          }
        }}
        aria-label="Name"
        className="h-8 w-52 rounded border bg-background px-2 text-xs text-foreground"
      />
    );
  }

  const untitled = isPlaceholderTitle(pageTitle);

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Rename"
      className={cn(
        'h-8 max-w-52 truncate rounded px-2 text-left text-xs hover:bg-accent',
        // An untitled record should look like it is asking to be named, not like a name.
        untitled ? 'text-muted-foreground italic' : 'font-medium text-foreground'
      )}
    >
      {pageTitle || 'Untitled page'}
    </button>
  );
}
