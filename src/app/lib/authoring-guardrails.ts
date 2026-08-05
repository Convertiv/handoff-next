import {
  collectEditableText,
  collectImageSrcs,
  getAtPath,
  mergeBlockArgs,
  type PatternComponentEntry,
} from './guest-editable';

/**
 * Guardrails for authored content — Slice 3 of `docs/GUEST-AUTHORING.md`.
 *
 * Client-safe and pure, like `./guest-editable`, because the same rules must run in three places and must
 * not drift: live in the editor as someone types, authoritatively on the server at submit, and as
 * annotations in the review queue. A limit enforced in the browser only is a suggestion.
 *
 * **Where limits come from, and why not the field descriptors.** The design note originally put these on
 * the FIELD-BRIDGE descriptors. That is wrong for content limits: descriptors describe a *component
 * contract* — code-owned, replaced on push — whereas "the headline on this campaign page maxes at 60
 * characters" is an editorial rule belonging to the **template instance**, authored by the same person who
 * built the template. So constraints are stored on the template (`data.guardrails`) and resolve
 * template-default → per-field override. A future descriptor-declared minimum could layer underneath
 * without changing callers.
 *
 * **Nothing is invented.** A length limit applies only where one was configured; the engine never guesses
 * that a 32-character template value implies a 32-character rule. The checks that need no configuration
 * are the ones that are unambiguous regardless of intent (a missing alt text, an empty required field,
 * link text that says "click here").
 */

export type GuardrailSeverity = 'blocking' | 'advisory';

/** Limits for one field path, as authored on the template. */
export interface FieldGuardrail {
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  /** Human note shown alongside the field — the template author's instruction to whoever fills it in. */
  help?: string;
}

export interface GuardrailConfig {
  /** Applies to every text field unless a per-field rule overrides it. */
  defaults?: { maxLength?: number };
  /** Keyed by dotted field path, e.g. `"headline"` or `"bodySlot.props.children"`. */
  fields?: Record<string, FieldGuardrail>;
  /** Require alt text on every image slot. Advisory by default; set to block submission. */
  requireImageAlt?: GuardrailSeverity | false;
  /** Flag uninformative link text. Advisory only — it is a judgement call, not a rule. */
  checkLinkText?: boolean;
}

export interface GuardrailFinding {
  blockIndex: number;
  componentId: string;
  /** Dotted field path, or null for a block-level finding. */
  path: string | null;
  label: string;
  severity: GuardrailSeverity;
  /** Machine-readable so a UI can group or a test can assert without matching prose. */
  code: 'too-long' | 'too-short' | 'required-empty' | 'missing-alt' | 'weak-link-text';
  message: string;
}

/** Link text that tells a screen-reader user nothing about where they are going. */
const WEAK_LINK_TEXT = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this link']);

/** Paths whose *label* reads as a link. Cheap heuristic; only ever advisory. */
const LINKISH = /(^|\.)(cta|link|button)(slot)?(\.|$)/i;

export function readGuardrailConfig(value: unknown): GuardrailConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;

  const config: GuardrailConfig = {};

  const defaults = raw.defaults as Record<string, unknown> | undefined;
  if (defaults && typeof defaults === 'object') {
    const max = Number(defaults.maxLength);
    if (Number.isInteger(max) && max > 0) config.defaults = { maxLength: max };
  }

  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    const fields: Record<string, FieldGuardrail> = {};
    for (const [path, rule] of Object.entries(raw.fields as Record<string, unknown>)) {
      if (!rule || typeof rule !== 'object') continue;
      const r = rule as Record<string, unknown>;
      const out: FieldGuardrail = {};
      const max = Number(r.maxLength);
      const min = Number(r.minLength);
      if (Number.isInteger(max) && max > 0) out.maxLength = max;
      if (Number.isInteger(min) && min > 0) out.minLength = min;
      if (r.required === true) out.required = true;
      if (typeof r.help === 'string' && r.help.trim()) out.help = r.help.trim().slice(0, 200);
      if (Object.keys(out).length) fields[path] = out;
    }
    if (Object.keys(fields).length) config.fields = fields;
  }

  if (raw.requireImageAlt === 'blocking' || raw.requireImageAlt === 'advisory') {
    config.requireImageAlt = raw.requireImageAlt;
  } else if (raw.requireImageAlt === false) {
    config.requireImageAlt = false;
  }

  if (raw.checkLinkText === true) config.checkLinkText = true;

  return config;
}

/** Pull the config off a template/page's `data`. */
export function guardrailsFromPatternData(data: unknown): GuardrailConfig {
  if (!data || typeof data !== 'object') return {};
  return readGuardrailConfig((data as Record<string, unknown>).guardrails);
}

/**
 * The effective rule for one field: per-field override on top of the template default.
 *
 * Exported because the editor needs it per input (to show "38/60") without running the whole check.
 */
export function resolveFieldGuardrail(config: GuardrailConfig, path: string): FieldGuardrail {
  const field = config.fields?.[path] ?? {};
  const maxLength = field.maxLength ?? config.defaults?.maxLength;
  return { ...field, ...(maxLength ? { maxLength } : {}) };
}

/** Dotted config path → the segment array `getAtPath` takes, with numeric segments as array indices. */
function parsePath(path: string): (string | number)[] {
  return path.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

/** Last meaningful segment of a configured path, for a message about a field that isn't there to label. */
function labelFromPath(path: string): string {
  const segments = path.split('.').filter((seg) => seg !== 'props' && seg !== 'children');
  const last = segments[segments.length - 1] ?? path;
  return last
    .replace(/Slot$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Alt text for an image whose src lives at `path` — the sibling `alt`, wherever the src sits. */
function altForImagePath(args: unknown, path: (string | number)[]): unknown {
  if (!path.length) return undefined;
  return getAtPath(args, [...path.slice(0, -1), 'alt']);
}

/**
 * Check one page against its guardrails.
 *
 * Takes the same `(blocks, overrides)` pair everything else in this flow takes, so the caller never has to
 * merge args itself and cannot accidentally check the template instead of the submission.
 */
export function checkGuardrails(
  blocks: PatternComponentEntry[],
  overrides: unknown[],
  config: GuardrailConfig
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];

  blocks.forEach((entry, blockIndex) => {
    const args = mergeBlockArgs(entry, overrides[blockIndex]);
    const base = { blockIndex, componentId: entry.id };

    for (const field of collectEditableText(args)) {
      const path = field.path.join('.');
      const rule = resolveFieldGuardrail(config, path);
      const length = field.value.trim().length;

      if (rule.maxLength && field.value.length > rule.maxLength) {
        findings.push({
          ...base,
          path,
          label: field.label,
          severity: 'blocking',
          code: 'too-long',
          message: `${field.label} is ${field.value.length} characters; the limit is ${rule.maxLength}.`,
        });
      }
      if (rule.minLength && length > 0 && length < rule.minLength) {
        findings.push({
          ...base,
          path,
          label: field.label,
          severity: 'blocking',
          code: 'too-short',
          message: `${field.label} is ${length} characters; at least ${rule.minLength} is expected.`,
        });
      }
      // `required` is deliberately NOT checked here — the dedicated pass below covers empty *and* absent,
      // and checking in both places would report the same field twice.

      if (config.checkLinkText && LINKISH.test(path) && WEAK_LINK_TEXT.has(field.value.trim().toLowerCase())) {
        findings.push({
          ...base,
          path,
          label: field.label,
          severity: 'advisory',
          code: 'weak-link-text',
          message: `“${field.value.trim()}” doesn't say where the link goes — describe the destination.`,
        });
      }
    }

    /**
     * Required fields get their own pass, because `collectEditableText` only reports strings that are
     * *there*: an empty or deleted slot is invisible to it, so a `required` rule would pass by absence —
     * the one failure mode a required check exists to catch.
     */
    for (const [path, rule] of Object.entries(config.fields ?? {})) {
      if (!rule.required) continue;
      const value = getAtPath(args, parsePath(path));
      const filled = typeof value === 'string' && value.trim().length > 0;
      if (filled) continue;
      findings.push({
        ...base,
        path,
        label: labelFromPath(path),
        severity: 'blocking',
        code: 'required-empty',
        message: `${labelFromPath(path)} is required.`,
      });
    }

    const altRule = config.requireImageAlt ?? 'advisory';
    if (altRule !== false) {
      for (const image of collectImageSrcs(args)) {
        const alt = altForImagePath(args, image.path);
        if (typeof alt === 'string' && alt.trim()) continue;
        findings.push({
          ...base,
          path: image.path.join('.'),
          label: image.label,
          severity: altRule,
          code: 'missing-alt',
          message: `${image.label} has no alt text — describe the image for anyone who cannot see it.`,
        });
      }
    }
  });

  return findings;
}

/** Blocking findings only — what stops a submission. */
export function blockingFindings(findings: GuardrailFinding[]): GuardrailFinding[] {
  return findings.filter((f) => f.severity === 'blocking');
}

/** One line for an error response or a submit button's tooltip. */
export function summarizeBlocking(findings: GuardrailFinding[]): string {
  const blocking = blockingFindings(findings);
  if (!blocking.length) return '';
  if (blocking.length === 1) return blocking[0].message;
  return `${blocking.length} things need fixing before this can be submitted: ${blocking
    .slice(0, 3)
    .map((f) => f.message)
    .join(' ')}${blocking.length > 3 ? ' …' : ''}`;
}
