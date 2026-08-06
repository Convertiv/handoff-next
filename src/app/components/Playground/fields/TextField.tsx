import { useState } from 'react';
import { Input } from '../../ui/input';
import { useEditContext } from '../EditContext';
import { useFieldGuardrails } from '../FieldGuardrailsContext';
import { resolveFieldGuardrail } from '@/lib/authoring-guardrails';

/**
 * A single-line text field, with the brief's content limit shown as you type.
 *
 * The limit hint lives here rather than in a guest-specific form because the shared editor is the only editor
 * now (roadmap E.5) — putting it in the field means guests *and* internal editors see the same rule, and it
 * restores the per-field counter that was lost when the hand-rolled guest form was retired.
 *
 * **No `maxLength` on the input.** Silently truncating pasted copy loses text without saying so; the counter
 * turns amber and the server refuses the submission with a reason instead.
 */
export function TextField({ identifier }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  // Its own context, not the playground's: this field also renders in the component workbench dialog, which
  // has no playground above it, and the field layer must not import server actions. No brief → no limits.
  const guardrails = useFieldGuardrails();

  const initial = getData(identifier) || '';
  /**
   * Mirrored locally purely so the counter moves. The input stays uncontrolled (`defaultValue`) as it always
   * was — making it controlled here would change typing behaviour for every component in the library.
   */
  const [length, setLength] = useState(String(initial).length);

  const rule = resolveFieldGuardrail(guardrails, identifier.join('.'));
  const over = rule.maxLength ? length > rule.maxLength : false;

  return (
    <div>
      <Input
        id={identifier[identifier.length - 1]}
        defaultValue={initial}
        onChange={(e) => {
          setLength(e.target.value.length);
          handleInputChange([...identifier], e.target.value);
        }}
      />
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
          can’t be submitted until it fits.
        </p>
      ) : null}
    </div>
  );
}
