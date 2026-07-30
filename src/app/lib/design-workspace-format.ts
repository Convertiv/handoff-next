import { BRAND_VOICE_SETTINGS } from '@/app/design/settings/settings-constants';
import { diffLines, diffStat, type DiffOp } from '@handoff/utils/line-diff';

export type BrandVoiceMap = Record<string, string>;

const BRAND_LABELS: Record<string, string> = Object.fromEntries(
  BRAND_VOICE_SETTINGS.map((s) => [s.id, s.label])
);

export function formatBrandVoiceForPrompt(brandVoice: BrandVoiceMap): string {
  const parts: string[] = [];
  for (const [id, value] of Object.entries(brandVoice)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const label = BRAND_LABELS[id] ?? id;
    parts.push(`### ${label}\n${trimmed}`);
  }
  return parts.join('\n\n');
}

// ── Guidance merge + diff (pure) ────────────────────────────────────────────
// `designMd` and `brandVoice` are standing instructions inherited by every later
// generation, so both write paths (settings UI, MCP) report what they replaced.
// The computation lives here, away from the db layer, so it stays testable.

export type BrandVoiceFieldId = (typeof BRAND_VOICE_SETTINGS)[number]['id'];

export const BRAND_VOICE_FIELD_IDS = BRAND_VOICE_SETTINGS.map((s) => s.id) as BrandVoiceFieldId[];

/** Per-field before/after so a voice rewrite is auditable from the response alone. */
export type BrandVoiceFieldChange = {
  field: BrandVoiceFieldId;
  label: string;
  action: 'added' | 'updated' | 'cleared';
  before: string;
  after: string;
  /** True when `before` or `after` was capped for reporting (the stored value is complete). */
  truncated: boolean;
};

const DIFF_FIELD_CAP = 2000;
const DIFF_DOC_CAP = 4000;

function capForDiff(value: string, cap: number): { text: string; truncated: boolean } {
  if (value.length <= cap) return { text: value, truncated: false };
  return { text: `${value.slice(0, cap)}…[truncated]`, truncated: true };
}

/**
 * Merge `fields` over `current`. Only keys present in `fields` are touched — an
 * absent key keeps its stored value, and an empty/whitespace value clears the
 * field. Returns the merged map plus which fields actually moved, so the caller
 * can skip the write entirely when nothing changed.
 */
export function mergeBrandVoiceFields(
  current: BrandVoiceMap,
  fields: Partial<Record<BrandVoiceFieldId, string>>
): { merged: BrandVoiceMap; changed: BrandVoiceFieldChange[]; unchanged: BrandVoiceFieldId[] } {
  const merged: BrandVoiceMap = { ...current };
  const changed: BrandVoiceFieldChange[] = [];
  const unchanged: BrandVoiceFieldId[] = [];

  for (const id of BRAND_VOICE_FIELD_IDS) {
    const incoming = fields[id];
    if (incoming === undefined) continue;
    const before = (current[id] ?? '').trim();
    const after = incoming.trim();
    if (before === after) {
      unchanged.push(id);
      continue;
    }
    if (after) merged[id] = after;
    else delete merged[id];
    const b = capForDiff(before, DIFF_FIELD_CAP);
    const a = capForDiff(after, DIFF_FIELD_CAP);
    changed.push({
      field: id,
      label: BRAND_LABELS[id] ?? id,
      action: !before ? 'added' : !after ? 'cleared' : 'updated',
      before: b.text,
      after: a.text,
      truncated: b.truncated || a.truncated,
    });
  }

  return { merged, changed, unchanged };
}

export type DesignGuidelinesDiff = {
  before: { chars: number; lines: number; text: string; truncated: boolean };
  after: { chars: number; lines: number; text: string; truncated: boolean };
  linesAdded: number;
  linesRemoved: number;
  /** Unified-style patch (`+`/`-`/context, `…` marks elided runs) of old → new. */
  patch: string;
  patchTruncated: boolean;
  unchanged: boolean;
};

/** Context lines kept around each change in `DesignGuidelinesDiff.patch`. */
const PATCH_CONTEXT_LINES = 2;
/** Cap on patch length so a full-document rewrite can't blow up the response. */
const PATCH_MAX_LINES = 300;

function buildPatch(ops: DiffOp[]): { patch: string; truncated: boolean } {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.type === 'context') return;
    const from = Math.max(0, i - PATCH_CONTEXT_LINES);
    const to = Math.min(ops.length - 1, i + PATCH_CONTEXT_LINES);
    for (let j = from; j <= to; j++) keep[j] = true;
  });

  const lines: string[] = [];
  let elided = false;
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) {
      elided = true;
      continue;
    }
    if (elided) {
      lines.push('…');
      elided = false;
    }
    const op = ops[i];
    lines.push(`${op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}${op.text}`);
  }

  if (lines.length > PATCH_MAX_LINES) {
    return { patch: lines.slice(0, PATCH_MAX_LINES).join('\n'), truncated: true };
  }
  return { patch: lines.join('\n'), truncated: false };
}

function guidelinesSide(value: string) {
  const capped = capForDiff(value, DIFF_DOC_CAP);
  return {
    chars: value.length,
    lines: value.trim() ? value.split('\n').length : 0,
    text: capped.text,
    truncated: capped.truncated,
  };
}

/** Old → new report for a wholesale `designMd` replacement. */
export function diffDesignGuidelines(before: string, after: string): DesignGuidelinesDiff {
  const ops = diffLines(before, after);
  const stat = diffStat(ops);
  const { patch, truncated: patchTruncated } = buildPatch(ops);
  return {
    before: guidelinesSide(before),
    after: guidelinesSide(after),
    linesAdded: stat.added,
    linesRemoved: stat.removed,
    patch,
    patchTruncated,
    unchanged: before === after,
  };
}

export function isWorkspaceEmpty(opts: {
  designMd: string;
  brandVoice: BrandVoiceMap;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl?: string }>;
}): boolean {
  const hasBrand = Object.values(opts.brandVoice).some((v) => v?.trim());
  const hasRefs = Object.values(opts.componentReferences).some((r) => r?.imageUrl?.trim());
  return (
    !opts.designMd.trim() &&
    !hasBrand &&
    !opts.customFoundationImageUrl.trim() &&
    !hasRefs
  );
}
