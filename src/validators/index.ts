/**
 * Public API for the validation framework (ADR-002).
 *
 * Consumers (workspace handoff.config.js, custom validator authors) import from
 * here:
 *
 * ```ts
 * import { axe, schema, contrast, type Validator } from 'handoff-app/validators';
 *
 * module.exports = {
 *   validation: {
 *     validators: [
 *       axe({ spec: 'wcag21aa' }),
 *       schema({ minPreviews: 2 }),
 *       contrast({ spec: 'wcag21aa' }),
 *     ],
 *   },
 * };
 * ```
 *
 * Built-in validator factories ship as separate sub-modules (added in #49-#51).
 * Each factory returns a Validator object; the runner doesn't differentiate
 * between built-ins and inline custom validators.
 */

export type {
  Severity,
  ValidationFinding,
  ValidatorResult,
  ValidatorInput,
  Validator,
  ComponentValidationOptOut,
  ValidationConfig,
} from '@handoff/types/validation';

// Built-in validators are exported by their own files as they're implemented.
// Stub factories live here for now so the public API surface is stable —
// implementations land in #49 (axe), #50 (schema), #51 (contrast).

/**
 * Placeholder factory — replaced with the real axe-core validator in #49.
 * Currently returns a no-op validator that always passes, so projects can
 * write the config now and pick up validation when the built-in lands.
 */
export function axe(opts?: Record<string, unknown>): import('@handoff/types/validation').Validator {
  void opts;
  return {
    id: 'axe',
    name: 'Accessibility (axe-core)',
    description: 'WCAG accessibility checks via axe-core',
    engineVersion: 'pending',
    async run({ component }) {
      return {
        validatorId: 'axe',
        validatorName: 'Accessibility (axe-core)',
        status: 'pass',
        severity: 'pass',
        findings: [],
        runAt: new Date().toISOString(),
        summary: 'axe validator is not yet implemented (placeholder, will land in task #49)',
      };
    },
  };
}

/**
 * Placeholder factory — replaced with the real schema validator in #50.
 */
export function schema(opts?: Record<string, unknown>): import('@handoff/types/validation').Validator {
  void opts;
  return {
    id: 'schema',
    name: 'Schema',
    description: 'Component declaration structural checks',
    engineVersion: 'pending',
    async run() {
      return {
        validatorId: 'schema',
        validatorName: 'Schema',
        status: 'pass',
        severity: 'pass',
        findings: [],
        runAt: new Date().toISOString(),
        summary: 'schema validator is not yet implemented (placeholder, will land in task #50)',
      };
    },
  };
}

/**
 * Placeholder factory — replaced with the real contrast validator in #51.
 */
export function contrast(opts?: Record<string, unknown>): import('@handoff/types/validation').Validator {
  void opts;
  return {
    id: 'contrast',
    name: 'Contrast',
    description: 'Runtime WCAG contrast ratio checks on rendered preview',
    engineVersion: 'pending',
    async run() {
      return {
        validatorId: 'contrast',
        validatorName: 'Contrast',
        status: 'pass',
        severity: 'pass',
        findings: [],
        runAt: new Date().toISOString(),
        summary: 'contrast validator is not yet implemented (placeholder, will land in task #51)',
      };
    },
  };
}
