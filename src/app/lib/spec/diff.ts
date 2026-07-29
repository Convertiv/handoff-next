import type { ComponentSpec } from '../server/design-spec-types';

/**
 * Semantic diff over a ComponentSpec.
 *
 * This exists because the spec is becoming the source of truth rather than a by-product of image
 * generation (see `docs/WORKBENCH-STRATEGY.md`). Once a client's tweak edits the spec instead of
 * re-rolling a raster, "what changed and why" has to be a first-class, durable answer — a textual
 * or index-based diff cannot provide it.
 *
 * Two rules make this useful rather than noisy:
 *
 *  1. **Entries are keyed by identity, not array position.** A model regenerating a spec will
 *     reorder `props` or `textInventory` freely; positional diffing would report every entry as
 *     changed. Props key on name, copy on its text + location, tokens on observed value + usage,
 *     reuse candidates on component id, voice findings on the copy they judge.
 *  2. **Volatile fields are ignored.** `generatedAt` changes on every run and means nothing to a
 *     reader.
 *
 * Deliberately dependency-free and pure so it can be unit-tested and reused on the client.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChangeKind = 'added' | 'removed' | 'changed';

/** One entry-level change inside a section. */
export interface SpecEntryChange {
  kind: ChangeKind;
  /** Identity of the entry, e.g. a prop name or a copy string. */
  key: string;
  /** Human-readable summary of what changed about it. */
  detail: string;
  /** Field-level befores/afters, present for `changed`. */
  fields?: { field: string; before: string; after: string }[];
}

/** All changes within one named section of the spec. */
export interface SpecSectionDiff {
  section: string;
  /** True when the section was absent before and present after (or vice-versa). */
  presenceChanged: boolean;
  entries: SpecEntryChange[];
  /** Scalar fields on the section itself, e.g. tokens.coverage or reuse.compositionScore. */
  fields: { field: string; before: string; after: string }[];
}

export interface SpecDiff {
  /** True when nothing meaningful changed. */
  unchanged: boolean;
  sections: SpecSectionDiff[];
  /** One-line summaries suitable for a changelog entry. */
  summary: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type AnyRec = Record<string, unknown>;

const asArray = (v: unknown): AnyRec[] => (Array.isArray(v) ? v.filter((x): x is AnyRec => !!x && typeof x === 'object') : []);

/** Stable, readable rendering of a scalar for before/after display. */
function show(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(show).join(', ');
  return JSON.stringify(v);
}

function scalarFieldDiffs(before: AnyRec, after: AnyRec, fields: string[]): { field: string; before: string; after: string }[] {
  const out: { field: string; before: string; after: string }[] = [];
  for (const f of fields) {
    const b = show(before?.[f]);
    const a = show(after?.[f]);
    if (b !== a) out.push({ field: f, before: b, after: a });
  }
  return out;
}

/**
 * Diff two keyed collections.
 *
 * `keyOf` supplies identity. `compare` lists the fields worth reporting when an entry survives —
 * anything not listed is treated as noise.
 */
function diffKeyed(
  beforeList: AnyRec[],
  afterList: AnyRec[],
  keyOf: (e: AnyRec) => string,
  compareFields: string[],
  label: (e: AnyRec) => string
): SpecEntryChange[] {
  const changes: SpecEntryChange[] = [];
  const beforeMap = new Map<string, AnyRec>();
  for (const e of beforeList) {
    const k = keyOf(e);
    if (k) beforeMap.set(k, e);
  }
  const seen = new Set<string>();

  for (const e of afterList) {
    const k = keyOf(e);
    if (!k) continue;
    seen.add(k);
    const prev = beforeMap.get(k);
    if (!prev) {
      changes.push({ kind: 'added', key: k, detail: `Added ${label(e)}` });
      continue;
    }
    const fields = scalarFieldDiffs(prev, e, compareFields);
    if (fields.length) {
      changes.push({
        kind: 'changed',
        key: k,
        detail: `Changed ${label(e)}: ${fields.map((f) => f.field).join(', ')}`,
        fields,
      });
    }
  }

  for (const [k, e] of beforeMap) {
    if (!seen.has(k)) changes.push({ kind: 'removed', key: k, detail: `Removed ${label(e)}` });
  }

  return changes;
}

/** Collapse whitespace so a reflowed string isn't reported as a change. */
const norm = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

// ── Section definitions ───────────────────────────────────────────────────────

/**
 * Token entries are identified by the value observed AND where it was used — the same colour
 * legitimately appears in several roles, and each is independently interesting.
 */
const TOKEN_GROUPS = ['colors', 'typography', 'spacing', 'radii'] as const;

function diffTokens(before: AnyRec | undefined, after: AnyRec | undefined): SpecSectionDiff {
  const entries: SpecEntryChange[] = [];
  for (const g of TOKEN_GROUPS) {
    entries.push(
      ...diffKeyed(
        asArray(before?.[g]),
        asArray(after?.[g]),
        (e) => `${g}:${norm(e.observed)}|${norm(e.usage)}`,
        ['token', 'reference', 'matchLevel', 'note'],
        (e) => `${g.replace(/s$/, '')} ${show(e.observed)} (${show(e.usage)})`
      )
    );
  }
  return {
    section: 'tokens',
    presenceChanged: !!before !== !!after,
    entries,
    fields: scalarFieldDiffs(before ?? {}, after ?? {}, ['coverage', 'notes']),
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function diffSpecs(before: ComponentSpec | null | undefined, after: ComponentSpec): SpecDiff {
  const b = (before ?? {}) as unknown as AnyRec;
  const a = after as unknown as AnyRec;

  const sections: SpecSectionDiff[] = [];

  // Overview — scalars only.
  sections.push({
    section: 'overview',
    presenceChanged: !!b.overview !== !!a.overview,
    entries: [],
    fields: scalarFieldDiffs((b.overview ?? {}) as AnyRec, (a.overview ?? {}) as AnyRec, [
      'name',
      'type',
      'designSystemGroup',
      'description',
      'summary',
    ]),
  });

  sections.push({
    section: 'variants',
    presenceChanged: false,
    entries: diffKeyed(asArray(b.variants), asArray(a.variants), (e) => norm(e.key), ['name', 'description', 'isDefault'], (e) => `variant "${show(e.key)}"`),
    fields: [],
  });

  sections.push({
    section: 'props',
    presenceChanged: false,
    entries: diffKeyed(
      asArray(b.props),
      asArray(a.props),
      (e) => norm(e.name),
      ['type', 'required', 'defaultValue', 'description', 'options'],
      (e) => `prop \`${show(e.name)}\``
    ),
    fields: [],
  });

  // Copy is the thing clients tweak most, so key on the text itself: a reworded string reads as
  // removed+added, which is the honest description of a copy change.
  const beforeContent = (b.content ?? {}) as AnyRec;
  const afterContent = (a.content ?? {}) as AnyRec;
  sections.push({
    section: 'content',
    presenceChanged: !!b.content !== !!a.content,
    entries: diffKeyed(
      asArray(beforeContent.textInventory),
      asArray(afterContent.textInventory),
      (e) => `${norm(e.text)}|${norm(e.location)}`,
      ['role', 'editable'],
      (e) => `copy "${show(e.text)}"`
    ),
    fields: [],
  });

  sections.push(diffTokens(b.tokens as AnyRec | undefined, a.tokens as AnyRec | undefined));

  const beforeReuse = (b.reuse ?? {}) as AnyRec;
  const afterReuse = (a.reuse ?? {}) as AnyRec;
  sections.push({
    section: 'reuse',
    presenceChanged: !!b.reuse !== !!a.reuse,
    entries: [
      ...diffKeyed(
        asArray(beforeReuse.candidates),
        asArray(afterReuse.candidates),
        (e) => `component:${norm(e.componentId)}`,
        ['role', 'confidence', 'note'],
        (e) => `component \`${show(e.componentId)}\``
      ),
      ...diffKeyed(
        asArray(beforeReuse.patterns),
        asArray(afterReuse.patterns),
        (e) => `pattern:${norm(e.patternId)}`,
        ['note'],
        (e) => `pattern \`${show(e.patternId)}\``
      ),
    ],
    fields: scalarFieldDiffs(beforeReuse, afterReuse, ['compositionScore', 'recommendation']),
  });

  const beforeVoice = (b.voice ?? {}) as AnyRec;
  const afterVoice = (a.voice ?? {}) as AnyRec;
  sections.push({
    section: 'voice',
    presenceChanged: !!b.voice !== !!a.voice,
    entries: diffKeyed(
      asArray(beforeVoice.findings),
      asArray(afterVoice.findings),
      (e) => norm(e.text),
      ['verdict', 'rule', 'detail', 'suggestion'],
      (e) => `finding on "${show(e.text)}"`
    ),
    fields: scalarFieldDiffs(beforeVoice, afterVoice, ['score', 'summary']),
  });

  const beforeImpl = (b.implementation ?? {}) as AnyRec;
  const afterImpl = (a.implementation ?? {}) as AnyRec;
  sections.push({
    section: 'implementation',
    presenceChanged: !!b.implementation !== !!a.implementation,
    entries: [],
    fields: scalarFieldDiffs(beforeImpl, afterImpl, ['cssNotes', 'developerHints', 'dependencies']),
  });

  const beforeA11y = (b.accessibility ?? {}) as AnyRec;
  const afterA11y = (a.accessibility ?? {}) as AnyRec;
  sections.push({
    section: 'accessibility',
    presenceChanged: !!b.accessibility !== !!a.accessibility,
    entries: [],
    fields: scalarFieldDiffs(beforeA11y, afterA11y, ['ariaRole', 'wcagTarget', 'screenReaderNotes', 'requiredAriaAttributes']),
  });

  const meaningful = sections.filter((s) => s.entries.length > 0 || s.fields.length > 0 || s.presenceChanged);

  return {
    unchanged: meaningful.length === 0,
    sections: meaningful,
    summary: summarize(meaningful, !before),
  };
}

/** One line per section, phrased for a changelog. */
function summarize(sections: SpecSectionDiff[], isFirstVersion: boolean): string[] {
  if (isFirstVersion) return ['Initial specification.'];
  const out: string[] = [];
  for (const s of sections) {
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const e of s.entries) counts[e.kind] += 1;
    const parts: string[] = [];
    if (counts.added) parts.push(`${counts.added} added`);
    if (counts.changed) parts.push(`${counts.changed} changed`);
    if (counts.removed) parts.push(`${counts.removed} removed`);
    if (s.fields.length) parts.push(`${s.fields.map((f) => f.field).join(', ')} updated`);
    if (s.presenceChanged && !parts.length) parts.push('section added or removed');
    if (parts.length) out.push(`${s.section}: ${parts.join(', ')}`);
  }
  return out.length ? out : ['No material changes.'];
}
