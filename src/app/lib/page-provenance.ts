// The app's own copy of the block shape. `@/transformers/...` is outside `src/app`'s path mapping — `tsc` at
// the root resolves it and `next build` does not, which is the same asymmetry that has caught this repo before.
import type { PatternComponentEntry } from '@/lib/guest-editable';

/**
 * Where a page came from, and what was true when it arrived.
 *
 * **This is the reflow's one substantive change to how the old model stored things** — see
 * `docs/PAGES-TEMPLATES-REFLOW.md` §2.1. Briefs stop being an object a person creates, versions and manages;
 * the frozen copy they existed to hold moves onto the created page, written once at submit.
 *
 * The argument, compressed: a built page's value to a reviewer is the comparison *"what did this person change
 * versus what they were handed"*. Share a live template with no copy taken and that comparison silently
 * re-bases every time the template is edited — the record stops being falsifiable, which is worse than not
 * keeping one. So the copy survives; only the ceremony around it dies.
 *
 * **Read-only after write.** Nothing in the app should offer to edit a provenance record. Where a value here
 * disagrees with the template as it stands today, the disagreement *is* the information.
 */
export interface PageProvenance {
  /**
   * The template this page was built from.
   *
   * Absent when it could not be recovered — see `legacy`. An absent link is honest; a guessed one is not.
   */
  templateId?: string;
  /** The template's `updatedAt` at fork time, so "has the template moved since?" is answerable. ISO-8601. */
  templateUpdatedAt?: string;
  /** When the guest started from the template. ISO-8601. */
  forkedAt?: string;
  /** When they submitted, which is when this page came into existence. ISO-8601. */
  submittedAt?: string;
  /**
   * The email the guest gave.
   *
   * ⚠️ **Self-asserted, confirmed only by delivery.** The return link is emailed, so a working address proves
   * the recipient received it — the same proof a magic link offers, and no more. Never treat this as identity.
   */
  submittedByEmail?: string;
  /** The template share link they came through. Kept even after the link is revoked — that is the point. */
  shareLinkToken?: string;
  /** The template's blocks as they stood at fork time: the copy the whole record exists to hold. */
  blocks?: PatternComponentEntry[];
  /** Findings as they stood at submit — what the checks said about this page when its author let go of it. */
  findings?: ProvenanceFinding[];
  /**
   * True when this record was **reconstructed by a migration** rather than written at submit.
   *
   * The difference between "this is what they were handed" and "this is our best reconstruction of what they
   * were handed" matters to anyone reading a diff, so it is recorded rather than smoothed over.
   */
  legacy?: boolean;
  /** The brief this was reconstructed from, and its version. Legacy records only. */
  legacyBriefId?: string;
  legacyBriefVersion?: number;
}

/**
 * Drop keys whose value is `undefined`.
 *
 * Storage does this anyway — `JSON.stringify` omits them, so a record written with `shareLinkToken: undefined`
 * comes back without the key at all. Doing it here means what we build equals what we read, and a round-trip
 * test can say so; without it the two shapes differ in a way that only shows up in an equality check nobody
 * writes until much later.
 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** A finding, flattened to what is still meaningful months later — not a live `AuditFinding`. */
export interface ProvenanceFinding {
  category: string;
  code: string;
  message: string;
  blockIndex?: number;
  path?: string;
}

/** What a row *is*, as opposed to how it got here (`source`). */
export type PatternKind = 'page' | 'template' | 'brief';

export const PATTERN_KINDS: readonly PatternKind[] = ['page', 'template', 'brief'];

/**
 * Read a `kind` off a row, tolerating rows written before the column existed.
 *
 * Defaults to `page` rather than throwing: an unrecognised kind means someone added one, and a library that
 * refuses to render is a worse answer than a page that shows up in the wrong lane.
 */
export function patternKind(value: unknown): PatternKind {
  return typeof value === 'string' && (PATTERN_KINDS as readonly string[]).includes(value)
    ? (value as PatternKind)
    : 'page';
}

/**
 * Parse a stored provenance value.
 *
 * Returns `null` for anything that is not an object, which is the normal case — most pages are hand-authored
 * and have no provenance at all. Field-level validation is deliberately loose: this is our own data, and a
 * record that is missing `forkedAt` is still worth showing.
 */
export function readProvenance(value: unknown): PageProvenance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined);
  const out: PageProvenance = {
    templateId: str('templateId'),
    templateUpdatedAt: str('templateUpdatedAt'),
    forkedAt: str('forkedAt'),
    submittedAt: str('submittedAt'),
    submittedByEmail: str('submittedByEmail'),
    shareLinkToken: str('shareLinkToken'),
    legacyBriefId: str('legacyBriefId'),
  };
  if (Array.isArray(raw.blocks)) out.blocks = raw.blocks as PatternComponentEntry[];
  if (Array.isArray(raw.findings)) out.findings = raw.findings as ProvenanceFinding[];
  if (raw.legacy === true) out.legacy = true;
  if (typeof raw.legacyBriefVersion === 'number') out.legacyBriefVersion = raw.legacyBriefVersion;
  const clean = compact(out);
  // An object with nothing usable in it is not provenance.
  return Object.keys(clean).length ? clean : null;
}

/**
 * Has the template changed since this page was forked from it?
 *
 * Answers "the thing you were handed is not the thing that exists now", which is the one question a live
 * template raises that a frozen brief did not. Unknown (`null`) when either timestamp is missing — three
 * states, because "we cannot tell" must not render as "no changes".
 */
export function templateHasMovedOn(
  provenance: PageProvenance | null,
  templateUpdatedAt: Date | string | null | undefined
): boolean | null {
  if (!provenance?.templateUpdatedAt || !templateUpdatedAt) return null;
  const forked = Date.parse(provenance.templateUpdatedAt);
  const current = Date.parse(typeof templateUpdatedAt === 'string' ? templateUpdatedAt : templateUpdatedAt.toISOString());
  if (Number.isNaN(forked) || Number.isNaN(current)) return null;
  // Second-granularity: the fork copy stores whole seconds, so a sub-second difference is storage precision
  // rather than an edit, and would otherwise report "moved on" for every page the moment it was created.
  return Math.floor(current / 1000) > Math.floor(forked / 1000);
}

/**
 * Build the record written at submit.
 *
 * Kept here rather than inline at the call site so there is exactly one place that decides what a provenance
 * record contains — the submit path, the MCP path and any future one must not each invent their own shape.
 */
export function buildProvenance(input: {
  template: { id: string; updatedAt?: Date | string | null; components?: unknown };
  forkedAt?: Date;
  submittedAt?: Date;
  submittedByEmail?: string | null;
  shareLinkToken?: string | null;
  findings?: ProvenanceFinding[];
}): PageProvenance {
  const iso = (d: Date | string | null | undefined): string | undefined => {
    if (!d) return undefined;
    const date = typeof d === 'string' ? new Date(d) : d;
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  const out: PageProvenance = {
    templateId: input.template.id,
    templateUpdatedAt: iso(input.template.updatedAt),
    forkedAt: iso(input.forkedAt),
    submittedAt: iso(input.submittedAt ?? new Date()),
    submittedByEmail: input.submittedByEmail?.trim() || undefined,
    shareLinkToken: input.shareLinkToken ?? undefined,
  };
  if (Array.isArray(input.template.components)) out.blocks = input.template.components as PatternComponentEntry[];
  if (input.findings?.length) out.findings = input.findings;
  return compact(out);
}
