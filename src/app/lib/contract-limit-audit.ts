/**
 * Find content limits a component contradicts itself about — the first check of Phase F's `F.-1`.
 *
 * **The component's own previews are the oracle.** A limit that rejects the value the component ships in its
 * own preview is wrong without anyone needing to know the real content corpus: the contract and the data
 * disagree, and the data is what renders. That is the same principle as `scaffold → render → assert`, applied
 * to lengths instead of shapes, and it needs no judgement call — which is what makes it safe to run over a
 * whole catalog and act on.
 *
 * **Why this exists.** Composing the ALPS `Resources` archetype (240 pages) through the MCP hit
 * `blog_header.title` capped at 25 characters, which 177 of those 240 titles exceed (Brad, 2026-08-10). The
 * same `{min: 5, max: 25}` block appeared on `title`, `read_time`, `publication_date`, `authors[].author` and
 * `authors[].role` — and the root cause turned out to be upstream of any author:
 * `config/templates/component/template.json` shipped exactly that block on **both** its example properties,
 * including `url`, where a 25-character cap rejects almost every real URL. The template has been fixed, so new
 * components stop inheriting it; this audit is how the ones already out there get triaged.
 *
 * Deliberately **not** included: any opinion about what a limit *should* be. Deciding that a title needs 110
 * characters requires the real corpus, which lives with whoever owns the content. This only reports
 * contradictions and the copy-paste signature. `content-length-plan.ts` holds the opinion, and this module borrows
 * three predicates from it so the two cannot disagree about what a length rule even *is*.
 */

import { isLengthRule, isReferenceField, roleFor } from './content-length-plan';

export type LimitFindingCode =
  /** The component's own preview value is longer than the limit it declares. */
  | 'preview-exceeds-max'
  /** The component's own preview value is shorter than the minimum it declares. */
  | 'preview-under-min'
  /** A length cap on a field that holds a URL — almost always meaningless. */
  | 'max-on-url'
  /** The identical rules block on several fields: the copy-paste signature. */
  | 'duplicated-rules';

export interface LimitFinding {
  componentId: string;
  code: LimitFindingCode;
  /** Dotted property path. Null for a component-level finding. */
  path: string | null;
  message: string;
  /** Fields sharing the block, for `duplicated-rules`. */
  fields?: string[];
}

/** Enough fields sharing one rules block to be a pattern rather than a coincidence. */
const DUPLICATE_THRESHOLD = 3;

interface FlatProp {
  path: string;
  key: string;
  /** Declared type, needed to tell a length rule from a row count or a numeric range. */
  type: string;
  rules: Record<string, unknown>;
  /** The component's declared default, used as a fallback oracle when no preview covers this field. */
  declaredDefault: unknown;
}

/** Walk `properties` into flat entries that actually declare rules. */
function flattenRuled(properties: unknown, prefix: string[] = []): FlatProp[] {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const out: FlatProp[] = [];
  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    const path = [...prefix, key];
    const rules = prop.rules;
    if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
      out.push({
        path: path.join('.'),
        key,
        type: typeof prop.type === 'string' ? prop.type : '',
        rules: rules as Record<string, unknown>,
        declaredDefault: prop.default,
      });
    }
    if (prop.properties) out.push(...flattenRuled(prop.properties, path));
    const items = prop.items as Record<string, unknown> | undefined;
    if (items?.properties) out.push(...flattenRuled(items.properties, [...path, '*']));
  }
  return out;
}

function limitsOf(rules: Record<string, unknown>): { max?: number; min?: number } {
  // `content` is canonical; flat `maxLength` is the legacy alias. Same precedence as the guardrail extractor.
  const content = (rules.content ?? {}) as Record<string, unknown>;
  const max = Number(content.max ?? rules.maxLength);
  const min = Number(content.min);
  return {
    ...(Number.isInteger(max) && max > 0 ? { max } : {}),
    ...(Number.isInteger(min) && min > 0 ? { min } : {}),
  };
}

/**
 * Longest string any preview holds at a path, ignoring array indices.
 *
 * The longest rather than the first: one preview ducking a cap while another exceeds it still means the cap is
 * wrong, and taking the longest is what surfaces that instead of hiding it behind whichever preview came first.
 */
function longestPreviewValue(previews: unknown, path: string): string | null {
  if (!previews || typeof previews !== 'object') return null;
  const wanted = path.split('.');
  let longest: string | null = null;

  const visit = (node: unknown, depth: number): void => {
    if (depth === wanted.length) {
      if (typeof node === 'string' && (longest === null || node.length > longest.length)) longest = node;
      return;
    }
    if (!node || typeof node !== 'object') return;
    const seg = wanted[depth];
    if (seg === '*' || Array.isArray(node)) {
      // Every row of an array shares one rule, so every row is a candidate.
      for (const item of Array.isArray(node) ? node : Object.values(node as object)) visit(item, depth + (seg === '*' ? 1 : 0));
      return;
    }
    visit((node as Record<string, unknown>)[seg], depth + 1);
  };

  for (const preview of Object.values(previews as Record<string, unknown>)) {
    const values = (preview as Record<string, unknown>)?.values ?? preview;
    visit(values, 0);
  }
  return longest;
}

export function auditContractLimits(input: {
  componentId: string;
  properties: unknown;
  previews?: unknown;
}): LimitFinding[] {
  const { componentId, properties, previews } = input;
  const findings: LimitFinding[] = [];
  const ruled = flattenRuled(properties);

  for (const prop of ruled) {
    const { max, min } = limitsOf(prop.rules);
    if (max === undefined && min === undefined) continue;

    /**
     * A cap on a reference. `isReferenceField` is shared with `content-length-plan.ts` rather than re-implemented,
     * and it carries the correction that matters here: a `text` field *named* `link` is a label, not a URL —
     * SS&C's `menu.primary.*.mega.link` is "Bottom Link Text" with a real 25-character constraint. Matching the
     * name alone reported it forever, and a report with permanent false positives stops being read.
     */
    if (max !== undefined && isReferenceField(prop.type, prop.path)) {
      findings.push({
        componentId,
        code: 'max-on-url',
        path: prop.path,
        message: `${prop.path} caps a URL at ${max} characters — a length limit on a URL is almost never a real constraint.`,
      });
    }

    /** Preview first, declared default as the fallback oracle when no preview covers the field. */
    const sample =
      longestPreviewValue(previews, prop.path) ??
      (typeof prop.declaredDefault === 'string' ? prop.declaredDefault : null);
    if (sample === null) continue;

    if (max !== undefined && sample.length > max) {
      findings.push({
        componentId,
        code: 'preview-exceeds-max',
        path: prop.path,
        message: `${prop.path} allows ${max} characters, but the component's own value is ${sample.length} — the contract rejects what it ships.`,
      });
    }
    if (min !== undefined && sample.length > 0 && sample.length < min) {
      findings.push({
        componentId,
        code: 'preview-under-min',
        path: prop.path,
        message: `${prop.path} requires at least ${min} characters, but the component's own value is ${sample.length}.`,
      });
    }
  }

  /**
   * The copy-paste signature: one identical rules block across several fields.
   *
   * Advisory on its own — a genuinely shared constraint is possible — but it is what turns "this one limit is
   * wrong" into "this whole block was pasted down the property list", which is the thing worth fixing.
   *
   * **Two exclusions, both learned by running this after the SS&C limits were rationalized**, where it went from
   * finding real paste damage to producing eight findings that were all correct-by-design:
   *
   * - **Row counts and numeric ranges are not in this game.** Three array fields sharing `{min: 1, max: 100}` is
   *   three deliberate cardinality rules, not a paste.
   * - **Fields whose shared cap is exactly their role's floor are deliberately consistent.** `menu` has six
   *   `title`-role fields at 60 because a card title *should* be 60 everywhere; flagging that is flagging the fix.
   *   A paste smell is fields of *different* roles sharing one number — a `title` and a `read_time` both at 25.
   */
  const byBlock = new Map<string, FlatProp[]>();
  for (const prop of ruled) {
    if (!isLengthRule(prop.type)) continue;
    const { max, min } = limitsOf(prop.rules);
    if (max === undefined && min === undefined) continue;
    const key = JSON.stringify({ max, min });
    byBlock.set(key, [...(byBlock.get(key) ?? []), prop]);
  }
  for (const [key, props] of byBlock) {
    if (props.length < DUPLICATE_THRESHOLD) continue;
    const fields = props.map((p) => p.path);
    const { max, min } = JSON.parse(key) as { max?: number; min?: number };
    // Every field's own role agrees on this number: consistency, not carelessness.
    const roleAgrees = props.every((p) => {
      const role = roleFor(p.key, p.path.includes('*'));
      return role !== null && role.limit === max && min === undefined;
    });
    if (roleAgrees) continue;
    findings.push({
      componentId,
      code: 'duplicated-rules',
      path: null,
      fields,
      message: `${fields.length} fields share the identical limit {${[
        min !== undefined ? `min: ${min}` : null,
        max !== undefined ? `max: ${max}` : null,
      ]
        .filter(Boolean)
        .join(', ')}} — likely pasted down the property list rather than set per field.`,
    });
  }

  return findings;
}
