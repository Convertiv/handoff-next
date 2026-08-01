/**
 * Read the slot capability record a component was pushed with.
 *
 * The record is produced at build time by rendering the component with sentinel values (see
 * `transformers/plugins/slot-probe.ts`) and says which encodings each `React.ReactNode` slot actually
 * accepts. It is the measured replacement for `shapeNote`, which asserted `{ src, alt }` for anything
 * whose field name matched /image/ and was wrong often enough to cost a month.
 *
 * Stored inside the component's `data` jsonb rather than its own column: adding a column to a hot table
 * breaks every read of it on any deployment where the migration has not landed, which took the
 * generation queue down on 2026-07-31.
 */

export interface SlotCapability {
  /** Accepted encodings, most specific first. `accepts[0]` is what a consumer should write. */
  accepts: string[];
  rejects: string[];
  threw: string[];
  unresolved: boolean;
}

export interface ComponentCapabilities {
  componentId: string;
  candidates: string[];
  slots: Record<string, SlotCapability>;
  unresolved: string[];
  error?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Pull the record off a component row.
 *
 * Returns null rather than an empty record when there is none, because **"not probed" and "probed and
 * found nothing" must stay distinguishable.** Treating an unprobed component as having no capabilities
 * would silently mark every one of its slots uneditable, which is the same class of confident-wrong
 * answer this whole mechanism exists to remove.
 */
export function readCapabilities(component: unknown): ComponentCapabilities | null {
  if (!isRecord(component)) return null;
  const data = isRecord(component.data) ? component.data : null;
  const raw = (isRecord(component.capabilities) ? component.capabilities : null) ?? (data && isRecord(data.capabilities) ? data.capabilities : null);
  if (!raw) return null;

  const slotsRaw = isRecord(raw.slots) ? raw.slots : {};
  const slots: Record<string, SlotCapability> = {};
  for (const [name, value] of Object.entries(slotsRaw)) {
    if (!isRecord(value)) continue;
    const accepts = Array.isArray(value.accepts) ? value.accepts.filter((a): a is string => typeof a === 'string') : [];
    slots[name] = {
      accepts,
      rejects: Array.isArray(value.rejects) ? value.rejects.filter((a): a is string => typeof a === 'string') : [],
      threw: Array.isArray(value.threw) ? value.threw.filter((a): a is string => typeof a === 'string') : [],
      unresolved: accepts.length === 0,
    };
  }

  return {
    componentId: typeof raw.componentId === 'string' ? raw.componentId : '',
    candidates: Array.isArray(raw.candidates) ? raw.candidates.filter((c): c is string => typeof c === 'string') : [],
    slots,
    unresolved: Object.entries(slots).filter(([, c]) => c.unresolved).map(([n]) => n),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

/**
 * The encoding a consumer should write into this slot, or null when there is no measured answer.
 *
 * Null covers three different situations on purpose — never probed, probed and nothing worked, or the
 * slot is not a slot at all — because every one of them means the same thing to a caller: **do not
 * guess a shape.** The failure mode being avoided is a form that reports success and changes nothing.
 */
export function encodingForSlot(caps: ComponentCapabilities | null, slot: string): string | null {
  return caps?.slots?.[slot]?.accepts?.[0] ?? null;
}

/** Whether a slot has any measured encoding. A slot without one should not be offered as editable. */
export function isSlotEditable(caps: ComponentCapabilities | null, slot: string): boolean {
  return !!encodingForSlot(caps, slot);
}
