/**
 * Minimal line-level diff (LCS) — no external dependency. Used by the component
 * version-compare UI to show what changed between two versions' text fields
 * (code/css/html) and JSON-serialized fields (properties/previews).
 */

export type DiffOpType = 'context' | 'add' | 'del';
export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/** Largest input (in lines) we run the O(n·m) LCS on before bailing out. */
const MAX_DIFF_LINES = 4000;

/**
 * Compute a line diff between `a` (old) and `b` (new). Returns an ordered list
 * of ops: `context` (unchanged), `del` (only in old), `add` (only in new).
 *
 * For very large inputs we skip the quadratic LCS and emit a coarse
 * "replace all" diff so the UI never hangs.
 */
export function diffLines(a: string, b: string): DiffOp[] {
  const aLines = a.length ? a.split('\n') : [];
  const bLines = b.length ? b.split('\n') : [];
  const n = aLines.length;
  const m = bLines.length;

  if (n === 0 && m === 0) return [];
  if (n + m > MAX_DIFF_LINES) {
    return [
      ...aLines.map((text): DiffOp => ({ type: 'del', text })),
      ...bLines.map((text): DiffOp => ({ type: 'add', text })),
    ];
  }

  // LCS length table (rows n+1, cols m+1), filled bottom-up.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: 'context', text: aLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: aLines[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: bLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', text: aLines[i++] });
  while (j < m) ops.push({ type: 'add', text: bLines[j++] });
  return ops;
}

/** Count added/removed lines in a diff. */
export function diffStat(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'del') removed++;
  }
  return { added, removed };
}

/** True when the two strings differ (cheap pre-check before diffing). */
export function textChanged(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') !== (b ?? '');
}
