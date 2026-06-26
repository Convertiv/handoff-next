/**
 * Schema validator (#50). Pure, fast structural checks on the built component
 * data — no browser, no I/O. Replaces hand-rolled "does this component have a
 * description / preview / properties?" lint scripts that projects accumulate.
 *
 * Designed as a sane default starting point; rules are individually skippable
 * via component-level `validation.skipRules`. Project-wide rule tweaks (e.g.
 * "require at least 3 previews") go through this factory's options.
 */

import type { Validator, ValidatorInput, ValidatorResult, ValidationFinding } from '@handoff/types/validation';

export interface SchemaOptions {
  /** Minimum number of preview variants per component. Default: 1. */
  minPreviews?: number;
  /** Require a non-empty title. Default: true. */
  requireTitle?: boolean;
  /** Require a non-empty description. Default: true. */
  requireDescription?: boolean;
  /** Require each property to have a `description` string. Default: true (warning). */
  requirePropertyDescriptions?: boolean;
  /** Require at least one source entry (template/component/js). Default: true. */
  requireEntry?: boolean;
  /**
   * Verify each preview's `values` keys reference properties declared in the
   * component's `properties` schema. Default: true (warning).
   */
  validatePreviewProperties?: boolean;
  /**
   * Verify each preview value conforms to its property's allowed `enum` options
   * (when the property declares them). Catches e.g. a preview claiming
   * `Type: "quaternary"` for an enum of primary|secondary|tertiary. Default: true (warning).
   */
  validatePreviewEnums?: boolean;
}

const DEFAULTS: Required<SchemaOptions> = {
  minPreviews: 1,
  requireTitle: true,
  requireDescription: true,
  requirePropertyDescriptions: true,
  requireEntry: true,
  validatePreviewProperties: true,
  validatePreviewEnums: true,
};

interface ComponentForSchema {
  id: string;
  title?: string;
  description?: string;
  previews?: Record<string, { values?: Record<string, unknown> }>;
  properties?: Record<string, { description?: string; type?: string; enum?: unknown[] }>;
  entries?: { js?: string; template?: string; component?: string; story?: string };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function schema(opts: SchemaOptions = {}): Validator {
  const cfg = { ...DEFAULTS, ...opts };

  return {
    id: 'schema',
    name: 'Schema',
    description: 'Structural checks on component declarations (title, description, previews, properties).',
    helpUrl: 'https://www.handoff.com/docs/validation/schema',
    async run(input: ValidatorInput): Promise<ValidatorResult> {
      const startedAt = Date.now();
      const c = input.component as unknown as ComponentForSchema;
      const findings: ValidationFinding[] = [];

      if (cfg.requireTitle && !isNonEmptyString(c.title)) {
        findings.push({
          ruleId: 'schema.title-required',
          severity: 'error',
          message: 'Component is missing a non-empty `title`.',
        });
      }

      if (cfg.requireDescription && !isNonEmptyString(c.description)) {
        findings.push({
          ruleId: 'schema.description-required',
          severity: 'warning',
          message: 'Component is missing a `description`. Add one to help consumers understand its purpose.',
        });
      }

      const previewKeys = Object.keys(c.previews ?? {});
      if (previewKeys.length < cfg.minPreviews) {
        findings.push({
          ruleId: 'schema.min-previews',
          severity: 'warning',
          message: `Expected at least ${cfg.minPreviews} preview variant(s), got ${previewKeys.length}.`,
        });
      }

      if (cfg.requireEntry) {
        const e = c.entries ?? {};
        const hasAny = isNonEmptyString(e.template) || isNonEmptyString(e.component) || isNonEmptyString(e.js);
        if (!hasAny) {
          findings.push({
            ruleId: 'schema.entry-required',
            severity: 'error',
            message: 'Component has no source entry (entries.template, entries.component, or entries.js).',
          });
        }
      }

      const properties = c.properties ?? {};
      const propertyKeys = Object.keys(properties);

      if (cfg.requirePropertyDescriptions && propertyKeys.length > 0) {
        for (const key of propertyKeys) {
          const meta = properties[key] ?? {};
          if (!isNonEmptyString(meta.description)) {
            findings.push({
              ruleId: 'schema.property-description',
              severity: 'warning',
              message: `Property "${key}" is missing a description.`,
              target: key,
            });
          }
        }
      }

      if (cfg.validatePreviewProperties && propertyKeys.length > 0) {
        const propertySet = new Set(propertyKeys);
        for (const previewKey of previewKeys) {
          const preview = c.previews?.[previewKey];
          const values = preview?.values ?? {};
          for (const valKey of Object.keys(values)) {
            if (!propertySet.has(valKey)) {
              findings.push({
                ruleId: 'schema.preview-unknown-property',
                severity: 'warning',
                message: `Preview "${previewKey}" references property "${valKey}" which is not declared in the component's properties schema.`,
                target: `previews.${previewKey}.values.${valKey}`,
              });
            }
          }
        }
      }

      if (cfg.validatePreviewEnums && propertyKeys.length > 0) {
        for (const previewKey of previewKeys) {
          const values = c.previews?.[previewKey]?.values ?? {};
          for (const valKey of Object.keys(values)) {
            const allowed = properties[valKey]?.enum;
            if (!Array.isArray(allowed) || allowed.length === 0) continue;
            const raw = (values as Record<string, unknown>)[valKey];
            const candidates = Array.isArray(raw) ? raw : [raw];
            for (const v of candidates) {
              const isPrimitive =
                typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
              if (isPrimitive && !allowed.includes(v)) {
                findings.push({
                  ruleId: 'schema.preview-invalid-enum',
                  severity: 'warning',
                  message: `Preview "${previewKey}" sets "${valKey}" to ${JSON.stringify(
                    v
                  )}, not one of its allowed values: ${allowed.map((a) => JSON.stringify(a)).join(', ')}.`,
                  target: `previews.${previewKey}.values.${valKey}`,
                });
              }
            }
          }
        }
      }

      const errorCount = findings.filter((f) => f.severity === 'error').length;
      const warnCount = findings.filter((f) => f.severity === 'warning').length;
      const severity =
        errorCount > 0 ? 'error' : warnCount > 0 ? 'warning' : findings.length > 0 ? 'info' : 'pass';

      return {
        validatorId: 'schema',
        validatorName: 'Schema',
        status: severity === 'pass' ? 'pass' : 'fail',
        severity,
        findings,
        runAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        summary:
          severity === 'pass'
            ? 'Schema OK.'
            : `${errorCount} error, ${warnCount} warning — ${findings.length} total finding(s).`,
      };
    },
  };
}
