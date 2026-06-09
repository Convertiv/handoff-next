/**
 * Component validation framework types (ADR-002).
 *
 * Validators are pluggable units that inspect a built component and return
 * structured findings. Built-in validators (axe, schema, contrast) and custom
 * validators authored in handoff.config.js share this same interface.
 *
 * Run in the workspace, results pushed to the registry as part of the
 * component payload — registry only displays, never runs validation.
 */

import type { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
// Avoid hard dep on playwright-core types in consumer-facing surface.
// Validators that need a browser ask for it via input.browser; the runtime is
// playwright's Browser shape but we keep the type loose so projects that
// don't import playwright don't need it transitively.
type PlaywrightBrowser = unknown;

/** Severity model used both at the finding level and the result level (max). */
export type Severity = 'error' | 'warning' | 'info' | 'pass';

/**
 * A single validation finding. Many findings per ValidatorResult; one
 * ValidatorResult per validator run per component.
 */
export interface ValidationFinding {
  /** Stable identifier for the rule. Convention: `${validatorId}.${ruleId}`. */
  ruleId: string;
  /** Severity of this specific finding. */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable description. */
  message: string;
  /** CSS selector or path identifying where in the rendered preview, if applicable. */
  target?: string;
  /** Snippet of the offending HTML / CSS / source. */
  snippet?: string;
  /** Link to remediation docs for this rule. */
  helpUrl?: string;
  /** Categorization tags (e.g. WCAG criteria like `wcag2aa`, `wcag143`). */
  tags?: string[];
}

/**
 * The result of one validator running against one component. Carries the
 * validator's display metadata so the registry UI can render without
 * cross-referencing the workspace config.
 */
export interface ValidatorResult {
  /** Stable validator identifier (matches Validator.id). */
  validatorId: string;
  /** Display name (matches Validator.name) — duplicated so UI doesn't need config. */
  validatorName: string;
  /** Status. `skipped` means opt-out at the component or config level. */
  status: 'pass' | 'fail' | 'skipped';
  /** Highest severity across findings. `pass` when no findings; `skipped` when opted out. */
  severity: Severity | 'skipped';
  findings: ValidationFinding[];
  /** ISO 8601 timestamp when this run completed. */
  runAt: string;
  /** Wall-clock duration in ms. Useful for debugging slow validators. */
  durationMs?: number;
  /** Short one-line summary for table views. */
  summary?: string;
  /** Reason for skipping (when `status === 'skipped'`). Required for audit transparency. */
  skipReason?: string;
  /** Optional validator-specific blob if the UI wants to render it specially. */
  details?: Record<string, unknown>;
  /** Version of the validator's underlying engine (e.g. axe-core version). */
  engineVersion?: string;
}

/**
 * Input handed to a validator's `run()` method.
 */
export interface ValidatorInput {
  /** The component being validated — declaration + built artifacts merged. */
  component: TransformComponentTokensResult;
  /** Absolute path to the default preview HTML on disk (for headless validators). */
  previewPath: string | null;
  /** Workspace root, for resolving sibling artifacts. */
  workingPath: string;
  /** Shared Playwright browser instance, if the runner launched one. Validators that
   *  don't need a browser ignore this. */
  browser?: PlaywrightBrowser;
  /** Per-project context the validator may use (brand voice, design guidelines, etc.). */
  context?: Record<string, unknown>;
}

/**
 * A validator. Built-in factories (axe, schema, contrast) return objects of
 * this shape; custom inline validators in handoff.config implement it directly.
 */
export interface Validator {
  /** Stable identifier — used for result lookups, config keys, UI filters. */
  id: string;
  /** Display name shown in registry UI. */
  name: string;
  /** Optional one-line description shown in tooltips/headers. */
  description?: string;
  /** Optional help URL for the validator itself (e.g. axe-core docs site). */
  helpUrl?: string;
  /** Optional engine version string, surfaced in results for traceability. */
  engineVersion?: string;
  /** The actual validation work. Should not throw — return a fail result instead. */
  run(input: ValidatorInput): Promise<ValidatorResult>;
}

/**
 * Per-component opt-out, declared in the component's `.handoff.ts`.
 *
 * ```ts
 * export default defineHandlebarsComponent({
 *   id: 'button',
 *   validation: {
 *     skip: ['contrast'],
 *     skipReason: 'Brand decision approved 2024-Q3.',
 *   },
 *   // ...
 * });
 * ```
 */
export interface ComponentValidationOptOut {
  /** Validator IDs to skip entirely for this component. */
  skip?: string[];
  /** Specific rule IDs to skip (e.g. ['axe.color-contrast']) across all validators. */
  skipRules?: string[];
  /** Justification for the skip. Surfaced in the registry UI so reviewers see why. */
  skipReason?: string;
}

/**
 * Project-level validation configuration in handoff.config.js.
 */
export interface ValidationConfig {
  /**
   * When the validator pipeline runs automatically. Default: 'push'.
   *  - 'push':   run during `handoff-app push[:all]` and `build:components`,
   *              regardless of whether the build cache hits — ensures the
   *              registry always shows current validation state. (default)
   *  - 'build':  only during `handoff-app build:components` when previews
   *              actually rebuild. Lighter; useful when validators are
   *              expensive and the project verifies a11y separately.
   *  - 'manual': only when `handoff-app validate` is invoked. Disables the
   *              automatic pass entirely.
   */
  runOn?: 'build' | 'push' | 'manual';
  /**
   * CI exit policy for `handoff-app validate --ci`.
   *  - 'error':   exit 1 when any validator returns error severity
   *  - 'warning': exit 1 on warning or error
   *  - 'never':   always exit 0 — results are advisory
   */
  failOn?: 'error' | 'warning' | 'never';
  /**
   * Ordered list of validators to run. Order is preserved in result arrays and
   * UI rendering. Mix of built-in factories (which return Validator) and inline
   * descriptors.
   */
  validators?: Validator[];
}
