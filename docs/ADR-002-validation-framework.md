# ADR-002: Component Validation Framework

**Status:** Proposed
**Date:** 2026-06-07
**Deciders:** Brad Mering
**Related:** ADR-001 (registry as service)

---

## Context

handoff-app today has a single hook — `handoff.config.hooks.validateComponent(component)` — that returns a validation result attached to the component metadata. SSC uses it to run axe-core accessibility checks via Puppeteer. The hook is functional but limited:

- One validator slot per project. Can't run multiple checks.
- No standard result shape. SSC's data is whatever they emit; the UI renders it ad-hoc.
- No severity model. Pass / fail only.
- No built-in validators. Every project hand-rolls a11y, schema, contrast.
- Results aren't first-class in the registry — no badges, no filters, no detail panel.

We want a real framework: built-in baseline validators (a11y, schema, contrast), a pluggable interface for custom validators, configurable per project, with results rendered prominently in the registry so designers and stakeholders can see component quality at a glance.

---

## Decision

A **validator** is a pluggable unit that inspects a built component and returns structured findings. Validators run in the workspace during the build pipeline. Results travel to the registry as part of the component payload and render as badges + detail panels.

### Core principles

1. **Validators live in the workspace, run at build time.** Workspace has Playwright, source files, local context. Registry stores and displays — never runs validation itself.

2. **Built-ins and custom validators share one interface.** No two-tier system. A built-in is a factory function that returns a validator descriptor; a custom is an inline descriptor. The runner doesn't know the difference.

3. **Results have a standard shape.** Severity, findings, targets — uniform across all validators. This is what makes the UI tractable.

4. **Configuration is in `handoff.config.js`.** Same place as everything else project-level. Per-project enable/disable, spec levels, rule overrides, and inline custom validators.

5. **Validation runs are cached.** Same source mtime → same results. Re-runs only on actual change.

---

## The Validator Interface

```ts
// Exported from handoff-app's public API

export interface Validator {
  /** Unique identifier — used for result lookups, config keys, UI filters. */
  id: string;
  /** Display name shown in registry UI. */
  name: string;
  /** Optional one-line description shown in tooltips. */
  description?: string;
  /** Optional help URL for the validator itself (e.g. axe-core docs). */
  helpUrl?: string;
  /** The actual work — called per component. */
  run(input: ValidatorInput): Promise<ValidatorResult>;
}

export interface ValidatorInput {
  /** Full component data: declaration + built artifacts. */
  component: TransformComponentTokensResult;
  /** Path on disk to the default preview HTML (for headless validators). */
  previewPath: string;
  /** Workspace root, for resolving sibling artifacts. */
  workingPath: string;
  /**
   * Shared Playwright browser instance — pass a launched browser here so the
   * a11y, contrast, and screenshot validators all reuse one chromium process.
   * Validators that don't need a browser ignore this field.
   */
  browser?: Browser;
  /**
   * Per-project additional context: brand voice, design guidelines, etc.
   * Pulled from handoff.config + design workspace settings.
   */
  context?: Record<string, unknown>;
}

export interface ValidatorResult {
  validatorId: string;
  /** Display name + description carried forward so registry can render
   *  without re-reading config. */
  validatorName: string;
  /** Highest severity in findings — drives badge color. */
  severity: 'error' | 'warning' | 'info' | 'pass';
  /** True iff no error-severity findings. */
  passed: boolean;
  findings: ValidationFinding[];
  /** ISO timestamp the validation ran. */
  runAt: string;
  /** Duration in ms — diagnostic for slow validators. */
  durationMs?: number;
  /** Short one-line summary for table views. */
  summary?: string;
  /** Validator-specific blob if the UI wants to render specially. */
  details?: Record<string, unknown>;
}

export interface ValidationFinding {
  /** Stable identifier for this rule across runs. e.g. `axe.color-contrast`. */
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  /** Human-readable description. */
  message: string;
  /** CSS selector or path identifying where in the rendered preview. */
  target?: string;
  /** Snippet of the offending HTML / CSS / config. */
  snippet?: string;
  /** Link to remediation docs (e.g. axe-core's help page for this rule). */
  helpUrl?: string;
  /** WCAG criteria or other categorization. */
  tags?: string[];
}
```

### Severity model

```
error    ← blocking issue, must fix before shipping
warning  ← should fix; doesn't block
info     ← notice (e.g. "no Figma link" — soft hint)
pass     ← validation succeeded, no findings
```

Result severity is the max of its findings' severities. The catalog badge color follows the worst severity across all validators for the component.

---

## Configuration

### handoff.config.js

```ts
import { axe, schema, contrast } from 'handoff-app/validators';

/** @type {import('handoff-app').Config} */
module.exports = {
  // ... existing config ...

  validation: {
    /**
     * When to run validators automatically.
     *  - 'build':  during `handoff-app build:components` (default)
     *  - 'push':   only when `handoff-app push --validate` is called
     *  - 'manual': only via `handoff-app validate`
     */
    runOn: 'build',

    /**
     * CI gate. Used by `handoff-app validate --ci`.
     *  - 'error':   exit non-zero if any validator returned 'error' severity
     *  - 'warning': exit non-zero on warning OR error
     *  - 'never':   always exit 0 (results are advisory only)
     */
    failOn: 'error',

    /**
     * List of validators to run. Both built-ins (factory functions returning
     * Validator) and custom (inline descriptor) go in the same list.
     * Order is preserved in the registry UI panels.
     */
    validators: [
      axe({
        spec: 'wcag21aa',
        rules: { disabled: ['color-contrast-enhanced'] },
      }),
      schema({
        minPreviews: 2,
        requireFigmaLink: true,
        requireImage: false, // we auto-generate screenshots now
      }),
      contrast({ spec: 'wcag21aa' }),

      // Custom inline validator
      {
        id: 'hubspot-compat',
        name: 'HubSpot Compatibility',
        description: 'Property types must map to HubSpot module fields.',
        async run({ component }) {
          const findings = [];
          for (const [name, prop] of Object.entries(component.properties ?? {})) {
            if (prop.type === 'icon') {
              findings.push({
                ruleId: 'hubspot.no-icon-type',
                severity: 'error',
                message: `Property "${name}" uses type 'icon' which has no HubSpot equivalent.`,
                target: `properties.${name}`,
                helpUrl: 'https://hubspot.com/...',
              });
            }
          }
          return {
            validatorId: 'hubspot-compat',
            validatorName: 'HubSpot Compatibility',
            severity: findings.length ? 'error' : 'pass',
            passed: findings.length === 0,
            findings,
            runAt: new Date().toISOString(),
          };
        },
      },
    ],
  },
};
```

### Per-component opt-out

Components can disable specific validators in their declaration when there's a legitimate reason:

```ts
// button.handoff.ts
export default defineHandlebarsComponent({
  id: 'button',
  // ...
  validation: {
    skip: ['contrast'],
    // Or scope by rule:
    skipRules: ['axe.color-contrast'],
    // With required justification — surfaced in the UI so reviewers see why
    skipReason: 'Button contrast is intentional brand decision approved by leadership 2024-Q3.',
  },
});
```

Skipped validators show as `skipped` (different from `pass`) in the UI with the justification visible on hover. Auditors can spot suppressed checks.

---

## Built-in validators

Each ships as a factory function from `handoff-app/validators`. They're optional — if you don't import them, they don't run.

### `axe(opts)` — accessibility

Runs axe-core against the rendered preview HTML in headless Chromium.

```ts
axe({
  spec: 'wcag21aa',
  // 'wcag2a' | 'wcag2aa' | 'wcag2aaa' | 'wcag21a' | 'wcag21aa' | 'wcag21aaa' | 'best-practice'
  rules: {
    disabled: ['color-contrast-enhanced'],
    enabled: ['experimental-rule'],
  },
  // axe impact level → handoff severity mapping (defaults below)
  impactSeverity: {
    critical: 'error',
    serious: 'error',
    moderate: 'warning',
    minor: 'info',
  },
})
```

Findings include the WCAG tags array, axe's help URL, and target selectors so the registry can highlight problem nodes.

### `schema(opts)` — declaration structure

Static checks against the `.handoff.ts` shape:

```ts
schema({
  minPreviews: 2,          // require N preview variants per component
  requireFigmaLink: true,  // warn if no figma URL
  requireImage: false,     // warn if no image (skip when screenshots auto-generate)
  requireDescription: true,
  requireTags: false,
  /** Allowed property type names. Catches typos and HubSpot-incompatible types. */
  allowedPropertyTypes: ['text', 'richtext', 'image', 'link', 'select', 'boolean', 'array', 'object', 'number'],
})
```

Catches the class of bugs SSC's `build/validate-schema.js` catches today, plus more.

### `contrast(opts)` — runtime color contrast

Walks the rendered preview DOM, computes contrast ratios for every text-vs-background pair, flags violations of the chosen WCAG level. Catches what axe can miss: token color combinations that don't actually meet contrast when used together in real DOM.

```ts
contrast({
  spec: 'wcag21aa',
  largeTextThresholdPx: 18,  // large-text rule kicks in above this
  // Skip elements matching CSS selectors (e.g. decorative)
  skipSelectors: ['[aria-hidden="true"]', '.decorative'],
})
```

### `tokenUsage(opts)` — design token discipline (future, post-v1)

Walks component SCSS / CSS, finds hard-coded hex/rgb/hsl values that should be CSS custom properties from the tokens. Warning-severity by default.

---

## When validation runs

### Default: during `build:components`

After the preview build and screenshot generation in `processComponents`, the validator runner kicks off. Results attach to `data.validations: ValidatorResult[]` and persist in the component's JSON. Same caching as the build: source files unchanged → previous results reused.

### On-demand: `handoff-app validate`

```bash
handoff-app validate                # all components, all validators
handoff-app validate button         # single component
handoff-app validate --validators=axe,schema  # subset of validators
handoff-app validate --json         # machine-readable to stdout
handoff-app validate --ci           # exit non-zero per failOn config
handoff-app validate --update       # write results to dist/, suppress stdout
```

### Optional: on push

```bash
handoff-app push --validate         # run validators before push, abort if failOn triggers
handoff-app push:all --validate
```

### Never on the registry side

Registry receives and displays results. It does not run validators — keeps the deployment simple (no Playwright/Chromium in the lambda) and ensures results are reproducible against the workspace's source state.

---

## Storage

### Component JSON

Validations live on the existing component object as `validations: ValidatorResult[]`. No new table needed for v1.

```jsonc
{
  "id": "button",
  "title": "Button",
  // ... existing fields ...
  "validations": [
    {
      "validatorId": "axe",
      "validatorName": "Accessibility (axe-core)",
      "severity": "warning",
      "passed": true,
      "findings": [
        {
          "ruleId": "axe.color-contrast",
          "severity": "warning",
          "message": "Element has insufficient color contrast of 4.4 (foreground #555, background #fff)",
          "target": ".btn-secondary",
          "helpUrl": "https://dequeuniversity.com/...",
          "tags": ["wcag2aa", "wcag143"]
        }
      ],
      "runAt": "2026-06-07T12:34:56.789Z",
      "durationMs": 423,
      "summary": "1 warning out of 47 rules checked"
    }
  ]
}
```

### Aggregate query support (future)

If projects want cross-component reports ("show me all components with axe errors"), we'd add a separate `handoff_component_validation` table later for efficient queries. v1 reads from the component JSON directly — fine at the scale of any single registry.

### Push contract

Component push already sends the full data payload. No changes needed — validations are part of `data` already. Migration path is fully backward-compatible.

---

## Registry UI

UI specifics are intentionally underspecified here — the design team owns layout, color, and interaction. What the data model promises:

- Every component has a `validations: ValidatorResult[]` array (possibly empty)
- Every result carries its own `validatorName` and `severity` so the UI doesn't need to cross-reference config
- Every finding carries `target`, `helpUrl`, `tags`, and a human-readable `message`
- Skipped validators are distinguishable from passing ones (skip carries a `skipReason`)
- Worst-severity rollup is trivially computable per-component

What the registry should surface in some form:

| Surface | What it shows | Why |
|---------|---------------|-----|
| Component catalog cards | Some indicator that the component has validation issues, ideally severity-colored | Scanability for reviewers |
| Component detail page | Per-validator results with expandable findings, run timestamps, opt-out justifications | Triage and fix workflow |
| Catalog filtering/sorting | Filter by validation status, sort by severity or finding count | Triage at scale |

Specific UI patterns (badge clusters vs. single rollup, tabs vs. panels, colors, icons) are the UI designer's call. The data is complete enough to support any of them.

A future aggregate dashboard (`/system/validation`) for rollups across the whole system — top violations, components by status, trends over time — is deferrable but the data shape supports it.

---

## Implementation phases

**Phase 1 — Framework + axe (#48 + #49)**
1. Define types in `src/types/validation.ts`
2. Implement validator runner in `src/transformers/validation/runner.ts`
3. Built-in axe validator
4. Wire into `processComponents` after screenshot generation
5. `handoff-app validate` CLI command
6. Tests: validator runs, results serialize, cache works

**Phase 2 — Schema + contrast (#50 + #51)**
- Schema validator (port SSC's logic + extend)
- Contrast validator (walks rendered DOM)

**Phase 3 — Registry UI (#52)**
- Badge cluster on catalog cards
- Validation tab on component detail page
- Filters on catalog

**Phase 4 — Aggregate + ci (future)**
- `/system/validation` dashboard page
- `--ci` flag + `failOn` enforcement
- Historical tracking table

---

## Open questions

1. **Validator versioning.** axe-core releases new rules over time. When a rule is added that newly fails a component, the workspace re-runs validation and pushes — fine. But how do we surface "this rule was added in axe-core 4.12, not your fault"? Track validator version in the result.

2. **Async/parallel limits.** Each validator may launch its own browser context. Default to sequential per-component, parallel across components, with a configurable concurrency cap. Same shape as the existing screenshot pipeline.

3. **Network-dependent validators.** Some checks might want to hit external services (e.g. broken-link check). Should validators have a `requiresNetwork: true` flag so CI can opt out of slow/flaky ones? Punt to a follow-up.

4. **Per-stack defaults.** Should `bootstrap-handlebars` projects get a different default config than `react-tailwind` (e.g. different axe rules)? Likely yes — store as defaults the stack guide alongside `src/stacks/*.md`. Punt to a follow-up.

5. **Diffs vs absolute results.** Should the UI show "violations introduced in this push" vs the absolute count? Requires comparing against the previous result. Worth adding in phase 4 with historical tracking.

---

## Why this design

- **Pluggable.** Same interface for built-ins and custom — no special-casing in the runner.
- **Configurable.** All knobs in handoff.config.js where projects already live.
- **Standardized.** One result shape means one UI codepath.
- **Workspace-runs / registry-displays.** Matches ADR-001 — registry is generic, content (including validation) is pushed.
- **Incremental.** Built-ins are optional imports. Projects with no validation config just don't run any. Backward compatible with the legacy `hooks.validateComponent` (which becomes a special-case custom validator under the hood).
- **Visible.** Catalog badges put quality front and center for stakeholders, not buried in CLI output.
