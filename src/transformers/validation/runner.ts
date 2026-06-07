/**
 * Validator runner — orchestrates a list of validators against a built component.
 * Called from the build pipeline after the preview HTML and screenshot exist.
 *
 * Responsibilities:
 *  - Resolve the default preview HTML path on disk (validators that need a
 *    browser load this via file://)
 *  - Honor per-component opt-out (component.validation.skip / skipRules)
 *  - Catch validator exceptions so a bad validator can't fail the whole build
 *  - Compute severity rollups (max of finding severities → result severity)
 *  - Return ValidatorResult[] for attachment to the component data
 *
 * Browser sharing across validators: the runner accepts an optional preLaunched
 * browser to share with axe/contrast and any other browser-based validators.
 * Validators that don't need a browser just ignore it. The screenshot pipeline
 * already manages a shared chromium instance; future work can plug into the
 * same browser to avoid double-launching.
 */

import path from 'node:path';
import fs from 'fs-extra';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import type { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { getComponentDistPath } from '@handoff/transformers/preview/component/api';
import type {
  ComponentValidationOptOut,
  Severity,
  Validator,
  ValidatorInput,
  ValidatorResult,
} from '@handoff/types/validation';

/**
 * Resolve the default preview HTML path for a component, matching the
 * screenshot pipeline's resolution order: 'default' > 'generic' > first variant.
 */
function findDefaultPreviewPath(handoff: Handoff, data: TransformComponentTokensResult): string | null {
  const distDir = getComponentDistPath(handoff, data.id);
  const previewKeys = Object.keys(data.previews ?? {});
  if (previewKeys.length === 0) return null;
  const priority = Array.from(new Set(['default', 'generic', ...previewKeys]));
  for (const key of priority) {
    const candidate = path.join(distDir, `${data.id}-${key}.html`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const SEVERITY_RANK: Record<Exclude<Severity, 'pass'>, number> = {
  info: 1,
  warning: 2,
  error: 3,
};

function maxFindingSeverity(findings: { severity: 'error' | 'warning' | 'info' }[]): Severity {
  if (findings.length === 0) return 'pass';
  let worst: Severity = 'pass';
  let worstRank = 0;
  for (const f of findings) {
    const r = SEVERITY_RANK[f.severity];
    if (r > worstRank) {
      worst = f.severity;
      worstRank = r;
    }
  }
  return worst;
}

/**
 * Extract the per-component opt-out from a component declaration, if present.
 * The validation field lives on TransformComponentTokensResult only when the
 * project's declaration sets it — guard accordingly.
 */
function getOptOut(data: TransformComponentTokensResult): ComponentValidationOptOut | undefined {
  const v = (data as unknown as { validation?: ComponentValidationOptOut }).validation;
  if (!v || typeof v !== 'object') return undefined;
  return v;
}

/**
 * Filter a validator's findings against the component's `skipRules` list. Skipped
 * findings are removed entirely (they don't show up as a separate category — the
 * component author asserted the rule isn't applicable here).
 */
function applySkipRules(result: ValidatorResult, skipRules: string[]): ValidatorResult {
  if (skipRules.length === 0) return result;
  const skipSet = new Set(skipRules);
  const filteredFindings = result.findings.filter((f) => !skipSet.has(f.ruleId));
  if (filteredFindings.length === result.findings.length) return result;
  const newSeverity = maxFindingSeverity(filteredFindings);
  return {
    ...result,
    findings: filteredFindings,
    severity: newSeverity,
    status: newSeverity === 'pass' ? 'pass' : 'fail',
  };
}

export interface RunValidatorsOpts {
  /** Subset of validator IDs to run. Default: run all configured. */
  only?: string[];
  /** Per-project context to thread into each validator. */
  context?: Record<string, unknown>;
}

/**
 * Run a list of validators against a single built component. Catches per-
 * validator exceptions so a thrown error becomes a fail result rather than
 * killing the whole build. Returns results in the same order validators were
 * configured.
 */
export async function runValidators(
  handoff: Handoff,
  data: TransformComponentTokensResult,
  validators: Validator[],
  opts: RunValidatorsOpts = {}
): Promise<ValidatorResult[]> {
  if (validators.length === 0) return [];

  const optOut = getOptOut(data);
  const skipValidators = new Set(optOut?.skip ?? []);
  const skipRules = optOut?.skipRules ?? [];
  const skipReason = optOut?.skipReason;

  const previewPath = findDefaultPreviewPath(handoff, data);
  const baseInput: Omit<ValidatorInput, never> = {
    component: data,
    previewPath,
    workingPath: handoff.workingPath,
    context: opts.context,
  };

  const results: ValidatorResult[] = [];

  for (const validator of validators) {
    if (opts.only && !opts.only.includes(validator.id)) continue;

    // Opt-out at component level — record as skipped so the registry can show it
    if (skipValidators.has(validator.id)) {
      results.push({
        validatorId: validator.id,
        validatorName: validator.name,
        status: 'skipped',
        severity: 'skipped',
        findings: [],
        runAt: new Date().toISOString(),
        skipReason: skipReason ?? 'Skipped by component declaration.',
        engineVersion: validator.engineVersion,
      });
      continue;
    }

    const startedAt = Date.now();
    let result: ValidatorResult;
    try {
      result = await validator.run(baseInput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`Validator "${validator.id}" threw on component "${data.id}": ${msg}`);
      result = {
        validatorId: validator.id,
        validatorName: validator.name,
        status: 'fail',
        severity: 'error',
        findings: [
          {
            ruleId: `${validator.id}.runtime-error`,
            severity: 'error',
            message: `Validator threw an exception: ${msg}`,
          },
        ],
        runAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        engineVersion: validator.engineVersion,
      };
    }

    // Normalize: ensure validatorId/validatorName/severity are correct even
    // if a custom validator returned partial data
    result = {
      ...result,
      validatorId: result.validatorId || validator.id,
      validatorName: result.validatorName || validator.name,
      severity: result.severity ?? maxFindingSeverity(result.findings),
      status: result.status ?? (result.severity === 'pass' ? 'pass' : 'fail'),
      engineVersion: result.engineVersion ?? validator.engineVersion,
      durationMs: result.durationMs ?? Date.now() - startedAt,
    };

    // Apply per-rule opt-outs
    result = applySkipRules(result, skipRules);

    results.push(result);
  }

  return results;
}

/** Convenience: compute the worst severity across a list of results. */
export function maxResultSeverity(results: ValidatorResult[]): Severity {
  let worst: Severity = 'pass';
  let worstRank = 0;
  for (const r of results) {
    if (r.severity === 'skipped' || r.severity === 'pass') continue;
    const rank = SEVERITY_RANK[r.severity];
    if (rank > worstRank) {
      worst = r.severity;
      worstRank = rank;
    }
  }
  return worst;
}
