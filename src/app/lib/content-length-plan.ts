/**
 * A proposed content limit for every field that declares one — the "rationalize these" half of the length work.
 *
 * `contract-limit-audit.ts` reports limits that are provably wrong (the component's own preview exceeds its own
 * cap) and **deliberately refused to say what a limit should be**, on the grounds that deciding a title needs 110
 * characters requires the real corpus. Brad asked for the opinion anyway (2026-08-11: "step 2 is to have you take
 * a best guess at length changes, and then I'll refine as I discover things we need to tweak"), so the two stay
 * separate: the audit still states only facts, and this states a **proposal**, per field, with its reasoning
 * attached so a wrong guess is arguable rather than mysterious.
 *
 * **Scope: contracts that declare limits, which means Handlebars in practice.** A React component's fields are
 * inferred and carry no `rules`, so it drops out naturally — no format check needed, and none wanted: a React
 * component that *does* declare rules deserves the same treatment.
 *
 * ---
 *
 * **Three findings from the SS&C survey shape every rule below** (83 components, 614 fields, 420 with a length
 * rule):
 *
 * 1. **`min` is the real damage — 389 fields carry one, and it protects nothing.** A minimum length cannot prevent
 *    a layout break; it only rejects legitimately short copy ("Go", "Q1 2026", "APAC"). It survived because the
 *    scaffolding template shipped `{min: 5, max: 25}` and it got pasted down every property list — 80 fields carry
 *    that exact pair, another 44 carry `{5, 30}` or `{5, 20}`. Requiredness is `rules.required`; that is the
 *    constraint anyone actually meant. So `min` is proposed for removal everywhere.
 *
 * 2. **A character count is the wrong instrument for many of the fields it is on.** Caps sit on URLs, icons and
 *    other asset references, where length is meaningless — `featured_resources.items.*.link` caps a link at 20,
 *    which no real URL survives. **But "the wrong instrument" is not the same as "delete it"**: on an `array` the
 *    same key is a row count and on a `number` it is a value range, both usually deliberate. See `NOT_A_LENGTH`.
 *
 * 3. **Where a cap is genuinely about layout, the numbers were set far too low.** `title` fields peak at 75
 *    characters in SS&C's own previews with a median of 19, yet 80 fields cap at 25. `paragraph` reaches 361 against
 *    caps of 100–300. This is the failure that blocked the ALPS migration: `blog_header.title` capped at 25 while
 *    177 of 240 real titles exceeded it.
 *
 * **The evidence floor is what keeps a guess honest.** A proposal is never below what the component already
 * ships — `max(roleDefault, observedLongest × 1.2)` — so applying this plan cannot reject content that renders
 * today. The role default is the opinion; the floor is the fact.
 */

/** What to do with a field's limits, and why. */
export type PlanAction =
  /** Length is the wrong instrument here: a URL, an icon, a composite, a config value. Drop the rule. */
  | 'remove-rule'
  /**
   * The rule is not a length at all — it is a row count or a numeric range. Left completely alone, minimum
   * included.
   */
  | 'not-a-length'
  /** Keep a cap, drop the minimum. The common case. */
  | 'drop-min'
  /** The cap is below what the component already ships, or below its role's floor. */
  | 'raise-max'
  /** The cap is far above anything the role needs — a real limit rather than a nominal one. */
  | 'lower-max'
  /** Already sensible. */
  | 'keep'
  /** No role match and no sample to measure: an opinion here would be invented. Left for a human. */
  | 'no-basis';

export interface PlanEntry {
  componentId: string;
  /** Dotted path, `*` for a repeater row. */
  path: string;
  type: string;
  current: { min?: number; max?: number };
  /** Absent `max` means "no cap"; `min` is never proposed. */
  proposed: { max?: number };
  action: PlanAction;
  /** The role the default came from, when one matched. */
  role: string | null;
  /** Longest value the component's own previews (or its declared default) hold at this path. */
  observed: number | null;
  reason: string;
  /** Richtext caps count markup, not copy — see `RICHTEXT_NOTE`. */
  countsMarkup?: boolean;
}

/**
 * Role → proposed cap, in characters.
 *
 * **Editable on purpose** — this table *is* the guess, and it is the thing to argue with. The numbers come from
 * the observed medians in SS&C's own previews plus headroom for real copy, not from a style guide: `title` at 80
 * covers a median of 19 and an observed peak of 75 with room for the long ALPS-style headlines that broke the
 * 25-character cap, while still being low enough that a two-line heading in a card is a warning rather than a
 * surprise.
 *
 * Matched on the **leaf** name, so `items.*.title` and `title` share a role — deliberately: one rule covers every
 * row of a repeater anyway, and a card title and a section title differ by *context*, which `IN_ROW_OVERRIDE`
 * handles rather than by having two names.
 */
export const ROLE_LIMITS: Record<string, number> = {
  // Headings.
  title: 80,
  heading: 80,
  headline: 80,
  subtitle: 160,
  subtitle_muted: 160,
  // Overlines, eyebrows and metadata — short by design, and the layout depends on it.
  title_prefix: 40,
  title_suffix: 40,
  super: 40,
  eyebrow: 40,
  kicker: 40,
  badge: 40,
  category: 40,
  label: 40,
  type: 40,
  read_time: 40,
  date: 40,
  publication_date: 40,
  /** A search field's placeholder — `filters.search` holds "Search Solutions". */
  search: 40,
  /**
   * A **link label**, not a URL: by the time a role is looked up, a `link`-*typed* field has already been handled
   * as a reference, so the only fields reaching this entry are `text` ones named `link` — SS&C's
   * `menu.primary.*.mega.link` ("Bottom Link Text") and `…menu.*.link` ("Link Text"). Same floor as a CTA label,
   * because that is what they are.
   */
  link: 32,
  /** A card heading — `menu.primary.*.mega.card.header`. Narrower inside a row, like any other heading. */
  header: 80,
  // Body copy.
  paragraph: 320,
  description: 320,
  body: 320,
  copy: 320,
  summary: 320,
  excerpt: 320,
  answer: 320,
  question: 120,
  quote: 240,
  callout: 120,
  copyright: 120,
  // People.
  author: 60,
  name: 60,
  role: 60,
  company: 60,
  // Calls to action — a button that wraps is a broken button.
  cta_label: 32,
  link_text: 32,
  button_label: 32,
  buttonlabel: 32,
  see_more_label: 32,
  see_less_label: 32,
  // Machine-facing strings. A cap here is about sanity, not layout; the `pattern` rule does the real work.
  identifier: 64,
  anchor: 64,
  slug: 64,
};

/**
 * A title inside a repeater row is a card title, and a card is narrower than a section.
 *
 * Only headings need this — body copy in a card is still body copy.
 */
export const IN_ROW_OVERRIDE: Record<string, number> = {
  title: 60,
  heading: 60,
  headline: 60,
  header: 60,
  subtitle: 120,
  // Kept in step with `subtitle` — the derived role table in the report generator is what caught them disagreeing.
  subtitle_muted: 120,
};

/**
 * Types where the rule is a misapplied *length* — it should go.
 *
 * `link` and `button` are composites (`{ text, href }`): a cap on the composite is nonsense, and the label inside
 * gets its own rule from its own name. `icon` holds markup or a class name. `image`/`video`/`asset` hold references.
 */
const MISAPPLIED_LENGTH = new Set(['url', 'link', 'button', 'icon', 'image', 'video', 'asset']);

/**
 * Types where `content.{min,max}` is **not a length**, so the whole rule is left alone — minimum included.
 *
 * ⚠️ This distinction was missed on the first pass and would have destroyed 78 deliberately-authored constraints.
 * On an `array`, `content` is a **row count**: `hero_split.breadcrumb` max 4, `menu.utilities` max 4,
 * `blog_header.authors` max 2, `blog_header.tags` min 1 max 10 — every one of those reads as a real design
 * decision. On a `number` it is a **value range**: `stats.items.*.duration` spans ±10,000,000 and
 * `filters.pagination.current` caps at 999.
 *
 * Nothing in the app enforces either today (`componentFieldRules` extracts `content` for every type and only
 * `TextField` consumes it), but "unenforced" is not "meaningless" — deleting an author's stated intent because the
 * runtime currently ignores it is how information is lost. `boolean`, `select`, `object` and `menu` are here too,
 * on the same conservative footing: not confidently a length, so not touched.
 */
const NOT_A_LENGTH = new Set(['array', 'number', 'boolean', 'select', 'object', 'menu', 'enum']);

/**
 * Is `content` on this field a length at all?
 *
 * Exported because `contract-limit-audit.ts` needs the same answer: a row count that happens to be shared across
 * three array fields is not a copy-paste smell, and reporting it as one is how a health check earns being ignored.
 * One definition, so the two cannot drift.
 */
export function isLengthRule(type: string): boolean {
  return !NOT_A_LENGTH.has(type);
}

/**
 * Does this field hold a reference rather than copy, so a character cap is meaningless?
 *
 * Exported for the same reason — and it carries the `link` correction: a `text` field *named* `link` is a label
 * (SS&C's `menu.primary.*.mega.link` is "Bottom Link Text"), so only the **type** may say "URL" for that word.
 */
export function isReferenceField(type: string, dottedPath: string): boolean {
  return MISAPPLIED_LENGTH.has(type) || URLISH.test(dottedPath) || CONFIGISH.test(dottedPath);
}

/**
 * Names that hold a URL whatever they were typed as — `cta_url` and `map_url` are declared `text` in SS&C.
 *
 * **`link` is deliberately absent.** It reads like a URL and often is not: SS&C's `menu.primary.*.mega.link` is
 * typed `text`, named "Bottom Link Text", rendered as the anchor's *label* (`template.hbs:149`) with a sibling
 * `href` holding the URL. Matching on the name alone stripped its 25-character cap — a cap that is real, because
 * that label sits in a fixed-width mega-menu footer. A `link`-*typed* field is still handled, by `NON_TEXTUAL`.
 */
const URLISH = /(^|[._*])(url|href|src|image|icon|video|file|path)([._*]|$)/i;

/**
 * Config masquerading as content. A CSS class has a length only incidentally.
 *
 * Same list as the field editor's content-only filter reasons about — config is not copy, and a limit on it is
 * measuring the wrong thing just as much as a limit on a URL.
 */
const CONFIGISH = /(^|[._*])(class|classname|id|theme|style|variant|size|align|target|rel)([._*]|$)/i;

/** A cap this far above its role's default is nominal rather than real, and worth pulling in. */
const LOWER_FACTOR = 4;

export const RICHTEXT_NOTE =
  'a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML';

interface Flat {
  path: string;
  leaf: string;
  inRow: boolean;
  type: string;
  rules: Record<string, unknown>;
  declaredDefault: unknown;
}

function flatten(properties: unknown, prefix: string[] = []): Flat[] {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const out: Flat[] = [];
  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    const path = [...prefix, key];
    const rules = prop.rules;
    if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
      out.push({
        path: path.join('.'),
        leaf: key,
        inRow: prefix.includes('*'),
        type: typeof prop.type === 'string' ? prop.type : '',
        rules: rules as Record<string, unknown>,
        declaredDefault: prop.default,
      });
    }
    if (prop.properties) out.push(...flatten(prop.properties, path));
    const items = prop.items as Record<string, unknown> | undefined;
    if (items?.properties) out.push(...flatten(items.properties, [...path, '*']));
  }
  return out;
}

function limitsOf(rules: Record<string, unknown>): { max?: number; min?: number } {
  // `content` is canonical, flat `maxLength` the legacy alias — same precedence as the guardrail resolver.
  const content = (rules.content ?? {}) as Record<string, unknown>;
  const max = Number(content.max ?? rules.maxLength);
  const min = Number(content.min);
  return {
    ...(Number.isInteger(max) && max > 0 ? { max } : {}),
    ...(Number.isInteger(min) && min > 0 ? { min } : {}),
  };
}

/** Longest string any preview holds at a path — the same walk the limit audit uses, and for the same reason. */
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
    if (wanted[depth] === '*') {
      for (const item of Array.isArray(node) ? node : []) visit(item, depth + 1);
      return;
    }
    visit((node as Record<string, unknown>)[wanted[depth]], depth + 1);
  };
  for (const preview of Object.values(previews as Record<string, unknown>)) {
    visit((preview as Record<string, unknown>)?.values ?? preview, 0);
  }
  return longest;
}

/** Round up to the next 10, so a proposal reads as a decision rather than as arithmetic output. */
const roundUp10 = (n: number): number => Math.ceil(n / 10) * 10;

/**
 * Affix fallbacks, for the composed names a flat table always misses.
 *
 * SS&C's unmatched vocabulary is 24 names and almost all of them are one-offs built from a known role:
 * `col1_label`, `transcript_label`, `map_title`, `feature_title`, `title_muted`. Matching the affix catches them
 * without pretending to know what `transcript` or `colorKey` are.
 */
const AFFIX_ROLES: [RegExp, string][] = [
  [/_label$/, 'label'],
  [/_title$/, 'title'],
  [/^title_/, 'title'],
  [/_paragraph$|_description$/, 'paragraph'],
  [/_name$/, 'name'],
];

export function roleFor(leaf: string, inRow: boolean): { role: string; limit: number } | null {
  const key = leaf.toLowerCase();
  const matched = key in ROLE_LIMITS ? key : AFFIX_ROLES.find(([re]) => re.test(key))?.[1];
  if (!matched) return null;
  return { role: matched, limit: (inRow && IN_ROW_OVERRIDE[matched]) || ROLE_LIMITS[matched] };
}

export function contentLengthPlan(input: {
  componentId: string;
  properties: unknown;
  previews?: unknown;
}): PlanEntry[] {
  const { componentId, properties, previews } = input;
  const out: PlanEntry[] = [];

  for (const prop of flatten(properties)) {
    const current = limitsOf(prop.rules);
    if (current.max === undefined && current.min === undefined) continue;

    const base = { componentId, path: prop.path, type: prop.type || '?', current };
    const sample =
      longestPreviewValue(previews, prop.path) ??
      (typeof prop.declaredDefault === 'string' ? prop.declaredDefault : null);
    const observed = sample === null ? null : sample.length;

    /**
     * 1. The rule is a row count or a numeric range, not a length. Hands off entirely — see `NOT_A_LENGTH`.
     */
    if (NOT_A_LENGTH.has(prop.type)) {
      out.push({
        ...base,
        proposed: { ...(current.max === undefined ? {} : { max: current.max }) },
        action: 'not-a-length',
        role: null,
        observed,
        reason:
          prop.type === 'number'
            ? `on a number, \`content\` is a value range — not this exercise's business`
            : `on \`${prop.type}\`, \`content\` counts rows rather than characters — left as authored`,
      });
      continue;
    }

    // 2. A length rule on something that has no meaningful length. Nothing survives, minimum included.
    if (MISAPPLIED_LENGTH.has(prop.type) || URLISH.test(prop.path) || CONFIGISH.test(prop.path)) {
      out.push({
        ...base,
        proposed: {},
        action: 'remove-rule',
        role: null,
        observed,
        reason: MISAPPLIED_LENGTH.has(prop.type)
          ? `type \`${prop.type}\` is a reference or a composite — a character count measures the wrong thing`
          : CONFIGISH.test(prop.path)
            ? `${prop.path} is configuration, not copy — its length is incidental`
            : `${prop.path} holds a URL or asset reference — a character count is not a constraint on it`,
      });
      continue;
    }

    const role = roleFor(prop.leaf, prop.inRow);
    const countsMarkup = prop.type === 'richtext' ? { countsMarkup: true } : {};

    // 2. No role and no sample: any number would be invented. Say so rather than guess.
    if (!role && observed === null) {
      out.push({
        ...base,
        proposed: current.max === undefined ? {} : { max: current.max },
        action: 'no-basis',
        role: null,
        observed,
        reason: `no role matched \`${prop.leaf}\` and no preview or default covers it — needs a human`,
        ...countsMarkup,
      });
      continue;
    }

    const roleLimit = role?.limit ?? 0;

    /**
     * The evidence floor: a proposal is never below what the component already renders, so applying this plan
     * cannot reject content that works today — the failure mode the whole exercise exists to remove.
     *
     * **It only engages where the content does not fit** — where the declared cap or the role default would reject
     * what the component ships. Adding headroom to content that already fits would restate every number in the
     * catalog for no reason, burying the ones that matter: SS&C's `mega.link` holds 18 characters against a cap of
     * 25, and "raise it to 30" is churn, not a finding.
     */
    const tightest = Math.min(current.max ?? Infinity, roleLimit || Infinity);
    const floor = observed !== null && observed > tightest ? roundUp10(observed * 1.2) : 0;
    const max = Math.max(floor, roleLimit);

    let action: PlanAction;
    let reason: string;
    if (current.max === undefined) {
      action = 'drop-min';
      reason = `no cap to change; the minimum of ${current.min} is the only rule and it protects nothing`;
    } else if (max > current.max) {
      action = 'raise-max';
      reason =
        observed !== null && observed > current.max
          ? `the component's own value is ${observed} characters against a cap of ${current.max} — the contract rejects what it ships`
          : `${current.max} is below the floor of ${roleLimit} for a ${role?.role ?? 'field'}`;
    } else if (prop.type === 'richtext') {
      /**
       * **Richtext is never pulled in.** Its cap counts markup, so the number is not comparable to a role floor
       * derived from plain text — and the generous caps are usually deliberate: `accordion.items.*.paragraph` at
       * 5000 is a multi-paragraph body, and the component's own guidance ("avoid lengthy body text, 3
       * paragraphs+") is the constraint, not a character count. Proposing 320 there would break the component.
       */
      action = current.min === undefined ? 'keep' : 'drop-min';
      reason = `richtext body — the cap of ${current.max} stays${current.min === undefined ? '' : `, the minimum of ${current.min} goes`}; ${RICHTEXT_NOTE}`;
    } else if (role && current.max > roleLimit * LOWER_FACTOR && floor <= roleLimit) {
      action = 'lower-max';
      reason =`${current.max} is ${Math.round(current.max / roleLimit)}× the ${role.role} floor — a nominal cap rather than a real one`;
    } else {
      action = current.min === undefined ? 'keep' : 'drop-min';
      reason =
        current.min === undefined
          ? `${current.max} already fits the ${role?.role ?? 'field'} and the content`
          : `the cap of ${current.max} is fine; the minimum of ${current.min} is not`;
    }

    out.push({
      ...base,
      // `lower-max` is the one case the floor does not decide, so it takes the role's number directly.
      proposed: { max: action === 'lower-max' ? roleLimit : Math.max(max, current.max ?? 0) },
      action,
      role: role?.role ?? null,
      observed,
      reason,
      ...countsMarkup,
    });
  }

  return out;
}

export interface PlanSummary {
  fields: number;
  byAction: Record<PlanAction, number>;
  /** Fields carrying a minimum — every one of them proposed for removal. */
  withMin: number;
  /** Caps that reject the component's own content. The subset that is not a judgement call. */
  selfContradicting: number;
  /** Richtext caps, which count markup rather than copy. */
  markupCounted: number;
}

export function summarizePlan(entries: PlanEntry[]): PlanSummary {
  const byAction = {
    'remove-rule': 0,
    'not-a-length': 0,
    'drop-min': 0,
    'raise-max': 0,
    'lower-max': 0,
    keep: 0,
    'no-basis': 0,
  } as Record<PlanAction, number>;
  let withMin = 0;
  let selfContradicting = 0;
  let markupCounted = 0;
  for (const e of entries) {
    byAction[e.action] += 1;
    if (e.current.min !== undefined) withMin += 1;
    if (e.current.max !== undefined && e.observed !== null && e.observed > e.current.max) selfContradicting += 1;
    if (e.countsMarkup) markupCounted += 1;
  }
  return { fields: entries.length, byAction, withMin, selfContradicting, markupCounted };
}
