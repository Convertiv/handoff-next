'use client';

import { useEffect, useRef } from 'react';
import { useEditContext } from '../EditContext';

/**
 * Rich-text slot editor (a `React.ReactNode` prop annotated `editorType: 'richtext'`,
 * e.g. 8x8's `titleSlot`/`bodySlot`).
 *
 * IMPORTANT — why the content is seeded via a ref and NOT `dangerouslySetInnerHTML`:
 * every keystroke calls `handleInputChange` → the shared edit `data` changes →
 * every `useEditContext` consumer (including this field) re-renders. If the
 * editable div used `dangerouslySetInnerHTML={{ __html }}`, React re-applies the
 * innerHTML on each render — the `{ __html }` object is a fresh reference every
 * time, so React's prop diff always treats it as changed and overwrites the DOM,
 * wiping the just-typed character and collapsing the caret to offset 0. That
 * produced the classic "only the most recent character, jammed at the front"
 * bug. By owning `innerHTML` imperatively through a ref (and giving the div NO
 * React-managed children), React never touches the editable content after the
 * initial seed, so typing and caret position survive re-renders.
 *
 * If the current value isn't a string (a raw ReactNode came from a code
 * preview), we don't try to edit it here.
 */
export function RichTextField({ identifier }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const ref = useRef<HTMLDivElement>(null);
  const idKey = identifier.join(' ');
  const seededFor = useRef<string | null>(null);

  // Seed the editable HTML once per field (re-seed only when the identifier
  // changes — e.g. this instance is reused for a different field). Guarded by a
  // ref so re-renders during editing never re-write the DOM.
  useEffect(() => {
    const el = ref.current;
    if (el && seededFor.current !== idKey) {
      seededFor.current = idKey;
      const current = getData(identifier);
      el.innerHTML = typeof current === 'string' ? current : '';
    }
  }, [idKey, getData, identifier]);

  const push = () => {
    const el = ref.current;
    if (!el) return;
    let html = el.innerHTML;
    // A visually-empty editor still leaves browser artifacts (`<br>`,
    // `<div><br></div>`). Store "" so the slot renders empty instead of a stray
    // tag/line. Keep non-text embeds (image/hr/etc.) even with no text.
    if (!el.textContent?.trim() && !/<(img|hr|iframe|svg|video)/i.test(html)) html = '';
    handleInputChange([...identifier], html);
  };

  // Toolbar commands mutate the DOM directly; push the result so the preview +
  // saved data stay in sync (execCommand's input event isn't guaranteed).
  const exec = (command: string) => {
    ref.current?.focus();
    document.execCommand(command);
    push();
  };

  return (
    <div>
      <div className="mb-1 flex space-x-1">
        <button type="button" title="Bold" className="rounded border px-2 py-1 text-sm" onClick={() => exec('bold')} tabIndex={-1}>
          <b>B</b>
        </button>
        <button type="button" title="Italic" className="rounded border px-2 py-1 text-sm" onClick={() => exec('italic')} tabIndex={-1}>
          <i>I</i>
        </button>
        <button type="button" title="Underline" className="rounded border px-2 py-1 text-sm" onClick={() => exec('underline')} tabIndex={-1}>
          <u>U</u>
        </button>
        <button type="button" title="List" className="rounded border px-2 py-1 text-sm" onClick={() => exec('insertUnorderedList')} tabIndex={-1}>
          &bull; List
        </button>
      </div>
      {/* No children + no dangerouslySetInnerHTML — content is owned via the ref
          (see the component doc comment). suppressContentEditableWarning silences
          React's warning about a contentEditable with managed children. */}
      <div
        id={identifier[identifier.length - 1]}
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[80px] rounded-md border bg-background px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-ring"
        onInput={push}
      />
    </div>
  );
}
