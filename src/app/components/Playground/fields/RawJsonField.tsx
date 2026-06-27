import { useEffect, useState } from 'react';
import { Textarea } from '../../ui/textarea';
import { useEditContext } from '../EditContext';

/**
 * Raw-value editor for `any`/unknown props (e.g. 8x8's Lottie `animationData`).
 * The shape is unknown to the inference, so we offer a JSON textarea: valid
 * JSON is committed to the data; invalid JSON is held locally and flagged
 * without clobbering the last good value. Beats the old `default` case, which
 * dumped the field *descriptor* (not even the value) via JSON.stringify.
 */
export function RawJsonField({ identifier }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const committed = getData(identifier);
  const [text, setText] = useState(() => safeStringify(committed));
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the underlying value changes from outside (e.g. preview switch).
  useEffect(() => {
    setText(safeStringify(committed));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier.join('.')]);

  return (
    <div className="space-y-1">
      <Textarea
        id={identifier[identifier.length - 1]}
        className="min-h-[80px] font-mono text-xs"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === '') {
            setError(null);
            handleInputChange([...identifier], null);
            return;
          }
          try {
            handleInputChange([...identifier], JSON.parse(next));
            setError(null);
          } catch {
            setError('Invalid JSON — not saved');
          }
        }}
      />
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

function safeStringify(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return '';
  }
}
