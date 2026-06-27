import { Textarea } from '../../ui/textarea';
import { useEditContext } from '../EditContext';

/**
 * Slot fill (a `React.ReactNode` prop, e.g. 8x8's `titleSlot`/`imageSlot`).
 *
 * A slot can hold arbitrary JSX, which a form can't author. Per the preview
 * schema (§12) the editable fallback is a text/child fill: the string typed
 * here becomes the slot's text content (matching `renderPreviewTextSlot`,
 * which accepts a raw string). Rich slots (image/button) get a declared
 * sub-schema later; until then this keeps the field editable instead of
 * dumping the descriptor as JSON.
 *
 * If the current value isn't a string (a raw ReactNode came in from a code
 * preview), we leave it untouched and show a read-only notice rather than
 * clobbering it.
 */
export function SlotField({ identifier, value }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const current = getData(identifier);
  const isEditableText = current == null || typeof current === 'string';

  if (!isEditableText) {
    return (
      <div className="rounded-md border border-dashed border-input bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Rich slot content (set in code) — not editable here.
      </div>
    );
  }

  return (
    <Textarea
      id={identifier[identifier.length - 1]}
      className="min-h-[60px] text-sm"
      placeholder={value?.description || 'Slot text content'}
      defaultValue={typeof current === 'string' ? current : ''}
      onChange={(e) => handleInputChange([...identifier], e.target.value)}
    />
  );
}
