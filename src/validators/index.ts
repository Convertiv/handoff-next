/**
 * Public API for the validation framework (ADR-002).
 *
 * Consumers (workspace handoff.config.js, custom validator authors) import from
 * here:
 *
 * ```ts
 * const { axe, schema, contrast } = require('handoff-app/validators');
 *
 * module.exports = {
 *   validation: {
 *     validators: [
 *       axe({ spec: 'wcag21aa' }),
 *       schema({ minPreviews: 2 }),
 *       contrast({ spec: 'wcag-aa' }),
 *     ],
 *   },
 * };
 * ```
 *
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

export { axe } from './axe';
export type { AxeOptions, AxeSpec } from './axe';

export { schema } from './schema';
export type { SchemaOptions } from './schema';

export { contrast } from './contrast';
export type { ContrastOptions, ContrastSpec } from './contrast';
