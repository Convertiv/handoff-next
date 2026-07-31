/**
 * Turn a thrown thing into a short string worth storing.
 *
 * Written after a job failure that was impossible to read. A Drizzle query error's `message` is
 * `Failed query: <sql> params: <every bound parameter>` — and when one of those parameters is a
 * multi-megabyte base64 image, clipping the message to 2000 characters keeps the base64 and discards
 * the `[cause]`, which is the only part that says what went wrong. The stored error was several
 * kilobytes of PNG and no diagnosis.
 *
 * So: the root cause first, parameter dumps dropped, long opaque runs elided.
 */

/** Maximum length of the summary. Fits a `text` column and a UI row without being useless. */
const MAX_SUMMARY = 600;

/**
 * The deepest `cause` in the chain, which for a wrapped DB error is the driver's own message — the one
 * naming the constraint, the column, or the syntax error.
 */
export function rootCause(err: unknown): unknown {
  let current = err;
  // Bounded: a self-referential cause chain would otherwise spin forever.
  for (let i = 0; i < 10; i += 1) {
    const next = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined;
    if (next === undefined || next === null || next === current) break;
    current = next;
  }
  return current;
}

/**
 * Strip the parts of a query error that carry data rather than meaning.
 *
 * `params:` onward is bound values, which for an image write is the image. Any remaining long
 * unbroken token is elided too — base64 arrives in other shapes, and a summary that is 90% payload
 * teaches people to ignore the field.
 */
export function stripPayloads(message: string): string {
  return message
    .replace(/\bparams:[\s\S]*$/i, '')
    // `=` only in the trailing position: base64 pads at the end, and including it in the leading class
    // makes `key=<long value>` swallow the key, losing the one word that said what the value was.
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A storable one-line summary: the root cause, then the wrapper for context if it adds anything.
 *
 * Both are included because either alone can be the useless one — the driver says
 * `violates foreign key constraint` without naming the query, and the wrapper names the query without
 * saying why it failed.
 */
export function summarizeError(err: unknown, maxLength = MAX_SUMMARY): string {
  const top = messageOf(err);
  const root = messageOf(rootCause(err));

  const parts: string[] = [];
  if (root) parts.push(root);
  // Only add the wrapper when it says something the root does not.
  if (top && top !== root && !root.includes(top)) parts.push(top);

  const summary = parts.map(stripPayloads).filter(Boolean).join(' — ');
  return (summary || 'Unknown error').slice(0, maxLength);
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message ?? '';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    // Postgres driver errors carry the useful text on `message`, with `detail`/`constraint` alongside.
    const o = value as { message?: unknown; detail?: unknown; constraint?: unknown };
    const bits = [o.message, o.detail, o.constraint].filter((v): v is string => typeof v === 'string' && !!v);
    if (bits.length) return bits.join(' ');
    return '';
  }
  return value === undefined || value === null ? '' : String(value);
}
