/**
 * Targeted edits to a page's block list.
 *
 * Before this, changing one headline on a nine-block page meant re-proposing all nine — expensive, and
 * it silently re-rolled copy the user was happy with. An operation says what to change and nothing
 * else, so refinement stops being regeneration.
 *
 * Pure: the same verification runs on the server, so the model can correct itself, and again on the
 * client at apply time, where the canvas is the actual truth.
 */

export interface PageBlock {
  componentId: string;
  args: Record<string, unknown>;
}

/**
 * `expect` is the component the operation believes sits at `index`.
 *
 * Positional reasoning is where this goes wrong — "before the footer" on a page with two footers, or
 * indices that shifted since the model last saw the page. Rather than prompting around it, every
 * operation states what it expects to find and is rejected if it is wrong. Editing the wrong block
 * silently is the failure worth spending code to prevent.
 */
export type EditOp =
  | { op: 'update'; index: number; expect: string; values: Record<string, unknown> }
  | { op: 'replace'; index: number; expect: string; componentId: string; values: Record<string, unknown> }
  | { op: 'insert'; index: number; componentId: string; values: Record<string, unknown> }
  | { op: 'remove'; index: number; expect: string };

export interface RejectedOp {
  op: EditOp;
  reason: string;
}

/** Human-readable one-liner for a changeset card. */
export function describeOp(op: EditOp): string {
  switch (op.op) {
    case 'update':
      return `Update block ${op.index + 1} (${op.expect}) — ${Object.keys(op.values).join(', ') || 'no fields'}`;
    case 'replace':
      return `Replace block ${op.index + 1}: ${op.expect} → ${op.componentId}`;
    case 'insert':
      return `Insert ${op.componentId} at position ${op.index + 1}`;
    case 'remove':
      return `Remove block ${op.index + 1} (${op.expect})`;
  }
}

/**
 * Check each operation against the page as it actually is.
 *
 * Partial acceptance on purpose: one stale index should not throw away four good edits. The caller
 * reports what was dropped rather than pretending everything applied.
 */
export function verifyOps(ops: EditOp[], blocks: PageBlock[]): { valid: EditOp[]; rejected: RejectedOp[] } {
  const valid: EditOp[] = [];
  const rejected: RejectedOp[] = [];

  for (const op of ops) {
    if (!Number.isInteger(op.index) || op.index < 0) {
      rejected.push({ op, reason: `index ${op.index} is not a position` });
      continue;
    }

    if (op.op === 'insert') {
      // Inserting at length is appending, which is legitimate.
      if (op.index > blocks.length) {
        rejected.push({ op, reason: `cannot insert at ${op.index + 1}; the page has ${blocks.length} blocks` });
        continue;
      }
      valid.push(op);
      continue;
    }

    const at = blocks[op.index];
    if (!at) {
      rejected.push({ op, reason: `there is no block ${op.index + 1}; the page has ${blocks.length}` });
      continue;
    }
    if (at.componentId !== op.expect) {
      rejected.push({
        op,
        reason: `block ${op.index + 1} is ${at.componentId}, not ${op.expect} — the page changed since this was planned`,
      });
      continue;
    }
    valid.push(op);
  }

  return { valid, rejected };
}

/**
 * Apply verified operations, returning a new block list.
 *
 * **Descending index order.** An insert or remove shifts every index after it, so applying in the
 * order the model wrote them would make later operations land on the wrong block. Sorting descending
 * means each operation acts on indices no earlier operation has disturbed.
 *
 * `update` merges over the block's existing args — that is what makes it cheaper than `replace`, since
 * only the changed fields need to travel.
 */
export function applyOps(blocks: PageBlock[], ops: EditOp[]): PageBlock[] {
  const out = blocks.map((b) => ({ ...b, args: { ...b.args } }));

  const ordered = [...ops].sort((a, b) => b.index - a.index);

  for (const op of ordered) {
    switch (op.op) {
      case 'update': {
        const target = out[op.index];
        if (target) target.args = { ...target.args, ...op.values };
        break;
      }
      case 'replace':
        out[op.index] = { componentId: op.componentId, args: op.values };
        break;
      case 'insert':
        out.splice(op.index, 0, { componentId: op.componentId, args: op.values });
        break;
      case 'remove':
        out.splice(op.index, 1);
        break;
    }
  }

  return out;
}

/**
 * What a changeset row should *show*, as opposed to what it says.
 *
 * "For any sort of component swaps, can you preview at all or just have to accept to see changes?" —
 * and the answer was accept-to-see. A fresh proposal renders a schematic thumbnail per block; a
 * changeset rendered one line of text per op. So the one operation where seeing the result matters most
 * — replacing a block with a different component — was the one with nothing to look at.
 *
 * Returned as data rather than markup so the decision is testable and the card stays dumb. `describeOp`
 * is kept: a text summary is still what a log line and a screen reader want.
 */
export interface OpVisual {
  /** Verb phrase for the row, in words rather than an op name. */
  action: string;
  /** 1-based, matching what the chat showed the user. */
  position: number;
  /** The component being displaced — `remove`, and the outgoing half of a `replace`. */
  before?: string;
  /** The component arriving — `insert`, and the incoming half of a `replace`. */
  after?: string;
  /** Fields an `update` touches. The identity is unchanged, so the thumbnail would say nothing. */
  fields?: string[];
}

export function describeOpVisually(op: EditOp): OpVisual {
  const position = op.index + 1;
  switch (op.op) {
    case 'update':
      // No thumbnail: the block is the same block. What changed is the field list, so that is the row.
      return { action: 'Update', position, before: op.expect, fields: Object.keys(op.values) };
    case 'replace':
      // Both halves, because "is this the right component" is answerable from the pictures and not from
      // two hyphenated ids. Monica reported the component type looking wrong on a swap twice.
      return { action: 'Swap', position, before: op.expect, after: op.componentId };
    case 'insert':
      return { action: 'Insert', position, after: op.componentId };
    case 'remove':
      return { action: 'Remove', position, before: op.expect };
  }
}
