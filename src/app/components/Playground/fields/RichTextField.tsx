'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditContext } from '../EditContext';
import { useFieldGuardrails } from '../FieldGuardrailsContext';
import { measuredLength, resolveFieldGuardrail, type FieldGuardrail } from '@/lib/authoring-guardrails';

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
export function RichTextField({ identifier, value }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const guardrails = useFieldGuardrails();
  const ref = useRef<HTMLDivElement>(null);
  const idKey = identifier.join(' ');
  const seededFor = useRef<string | null>(null);

  /**
   * The declared limit, read off the property definition the same way `TextField` does.
   *
   * This field previously showed **no counter at all** while the server still enforced the limit — and enforced it
   * against the HTML, so an author could be blocked by a rule they could not see, counting tags they never typed
   * (roadmap E.9, fixed 2026-08-11). `richtext: true` is what makes both ends count the copy.
   */
  const declared: FieldGuardrail = { richtext: true };
  const declaredMax = Number(value?.rules?.content?.max ?? value?.rules?.maxLength);
  const declaredMin = Number(value?.rules?.content?.min);
  if (Number.isInteger(declaredMax) && declaredMax > 0) declared.maxLength = declaredMax;
  if (Number.isInteger(declaredMin) && declaredMin > 0) declared.minLength = declaredMin;
  if (value?.rules?.required === true) declared.required = true;
  const rule = resolveFieldGuardrail(guardrails, identifier.join('.'), declared);

  const [length, setLength] = useState(() => {
    const current = getData(identifier);
    return measuredLength(typeof current === 'string' ? current : '', true);
  });
  const over = rule.maxLength ? length > rule.maxLength : false;

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
    // Measured from the stored HTML rather than `el.textContent`, so the counter reports exactly what the server
    // will measure on submit. Using textContent here would drift the moment the two normalise whitespace
    // differently — and the whole point of this fix is that the two agree.
    setLength(measuredLength(html, true));
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
      {/* Same shape as TextField's, so a limit reads identically whichever kind of field carries it. */}
      {rule.maxLength || rule.help ? (
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{rule.help ?? ''}</span>
          <span className={`text-xs ${over ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
            {length}
            {rule.maxLength ? `/${rule.maxLength}` : ''}
          </span>
        </div>
      ) : null}
      {over ? (
        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
          Over the limit by {length - rule.maxLength!} character{length - rule.maxLength! === 1 ? '' : 's'} — it
          can’t be submitted until it fits. Formatting tags don’t count.
        </p>
      ) : null}
    </div>
  );
}
