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

/** Link text that tells a screen-reader user nothing about where they are going. Shared with the audit pass. */
export const WEAK_LINK_TEXT = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this link']);

/** Paths whose *label* reads as a link. Cheap heuristic; only ever advisory. Shared with the audit pass. */
export const LINKISH = /(^|\.)(cta|link|button)(slot)?(\.|$)/i;

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
/**
 * Limits a **component itself** declares, keyed by field path (roadmap E.9).
 *
 * Separate from `GuardrailConfig.fields` because that map is keyed by a *global* path — a `title` rule there
 * applies to `title` on every block. A component-declared limit is inherently per-component: a hero headline
 * and a card headline both live at `titleSlot` and break at different lengths. So these are looked up per
 * block, by `componentId`.
 *
 * Array items collapse to `*`: a rule declared on `stats.items.stat` applies to `stats.0.stat`,
 * `stats.1.stat`, and so on. There is one rule per *field*, not per row.
 */
export type ComponentFieldRules = Record<string, FieldGuardrail>;
export type ComponentRulesById = Record<string, ComponentFieldRules>;

/**
 * Walk a component's `properties` tree into flat `path → rule` entries.
 *
 * Only `maxLength` and `required` are taken. `dimensions` is an image concern and has its own handling, and
 * inventing anything else here would break the module's rule that nothing is guessed.
 */
export function componentFieldRules(properties: unknown): ComponentFieldRules {
  const out: ComponentFieldRules = {};

  const walk = (node: unknown, prefix: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const prop = raw as Record<string, unknown>;
      const path = [...prefix, key];

      const rules = prop.rules as Record<string, unknown> | undefined;
      if (rules && typeof rules === 'object') {
        const rule: FieldGuardrail = {};
        /**
         * `rules.content.{min,max}` is the canonical declaration — what the component scaffolding template
         * models, what `RulesSheet` renders, and what real registries carry. The flat `maxLength` is read only
         * as a fallback: E.9 first shipped reading it exclusively, which meant it read a key **no registry
         * used** and picked up no limits at all (corrected 2026-08-10).
         */
        const content = (rules.content ?? {}) as Record<string, unknown>;
        const max = Number(content.max ?? rules.maxLength);
        const min = Number(content.min);
        if (Number.isInteger(max) && max > 0) rule.maxLength = max;
        if (Number.isInteger(min) && min > 0) rule.minLength = min;
        if (rules.required === true) rule.required = true;
        if (Object.keys(rule).length) out[path.join('.')] = rule;
      }

      if (prop.properties) walk(prop.properties, path);
      // `items` describes every row, so its fields sit under `*` rather than any index.
      const items = prop.items as Record<string, unknown> | undefined;
      if (items?.properties) walk(items.properties, [...path, '*']);
    }
  };

  walk(properties, []);
  return out;
}

/**
 * Find the component-declared rule for a concrete field path.
 *
 * Two normalisations, both because the path the *editor* produces comes from walking real args while the
 * declaration comes from walking the property tree:
 * - numeric segments become `*` (`stats.0.stat` → `stats.*.stat`);
 * - a trailing `props.children` is dropped, because a serialized React element is declared at its own key
 *   (`bodySlot`) while the editable text inside it is found at `bodySlot.props.children`.
 */
export function declaredRuleForPath(rules: ComponentFieldRules | undefined, path: string): FieldGuardrail {
  if (!rules) return {};
  const normalized = path
    .split('.')
    .map((seg) => (/^\d+$/.test(seg) ? '*' : seg))
    .join('.');
  if (rules[normalized]) return rules[normalized];
  const stripped = normalized.replace(/\.props\.children$/, '');
  return rules[stripped] ?? {};
}

/**
 * The rule in force for one field — **most specific wins**.
 *
 * 1. an explicit per-field rule on the brief (someone decided *this* field on *this* invitation),
 * 2. then the component's own declared limit (specific to this component and field),
 * 3. then the brief's blanket default.
 *
 * Deliberately not `min()` of the three. A brief author setting a field explicitly means it, and silently
 * tightening it to a component's number would make the UI disagree with what they typed. Ordering by
 * specificity also stops a brief's blanket default from masking a component's structural limit, which is the
 * case a simple fallback chain would get wrong.
 */
export function resolveFieldGuardrail(
  config: GuardrailConfig,
  path: string,
  declared?: FieldGuardrail
): FieldGuardrail {
  const field = config.fields?.[path] ?? {};
  const maxLength = field.maxLength ?? declared?.maxLength ?? config.defaults?.maxLength;
  const required = field.required ?? declared?.required;
  return {
    ...declared,
    ...field,
    ...(maxLength ? { maxLength } : {}),
    ...(required ? { required } : {}),
  };
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
/**
 * Where the alt text for an image slot lives: the sibling `alt` of the `src` that identifies it.
 *
 * Exported so the audit pass reads alt the same way this does — one definition of the relationship, not two
 * that can drift.
 */
export function altForImagePath(args: unknown, path: (string | number)[]): unknown {
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
  config: GuardrailConfig,
  /**
   * Component-declared limits by component id (roadmap E.9). Optional: absent, behaviour is exactly what it
   * was, which is what keeps "no declaration → no enforcement" true.
   */
  componentRules?: ComponentRulesById
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];

  blocks.forEach((entry, blockIndex) => {
    const args = mergeBlockArgs(entry, overrides[blockIndex]);
    const base = { blockIndex, componentId: entry.id };
    const declaredForBlock = componentRules?.[entry.id];

    for (const field of collectEditableText(args)) {
      const path = field.path.join('.');
      const rule = resolveFieldGuardrail(config, path, declaredRuleForPath(declaredForBlock, path));
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
    /**
     * Both sources of `required`, deduped. A component-declared one has to be here too, or a required field
     * the builder deleted outright would pass by absence — exactly the case this pass exists for.
     *
     * Paths containing `*` are skipped: they describe every row of an array, so there is no single value to
     * look up. Per-row required-ness would need the array walked, which is more than "nothing is invented"
     * allows without a decision about empty rows.
     */
    const requiredPaths = new Set([
      ...Object.keys(config.fields ?? {}),
      ...Object.keys(declaredForBlock ?? {}).filter((p) => !p.includes('*')),
    ]);
    for (const path of requiredPaths) {
      const rule = resolveFieldGuardrail(config, path, declaredRuleForPath(declaredForBlock, path));
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
