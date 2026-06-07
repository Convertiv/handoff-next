/**
 * axe-core a11y validator (#49).
 *
 * Loads the component's default preview HTML in headless Chromium, injects the
 * axe-core script, and runs the configured ruleset. Findings are mapped 1:1 to
 * ValidationFindings with severity derived from axe's impact level.
 *
 * Why headless: axe needs a real DOM with computed styles to evaluate things
 * like color-contrast and aria-hidden visibility. We can't do this from JSDOM.
 *
 * Why we resolve assets via the route interceptor: axe needs the page to look
 * like it does at runtime — fonts, icons, shared bundles all in place — so
 * findings line up with what users will see in the registry.
 *
 * Cost: ~600ms per component on first call (chromium launch) + ~250ms per
 * subsequent. Validators share the same chromium process via
 * `getSharedBrowser`, so the cost is mostly the per-component context setup
 * plus axe execution.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'fs-extra';
import type { Validator, ValidatorInput, ValidatorResult, ValidationFinding } from '@handoff/types/validation';
import { openPreviewPage } from '@handoff/transformers/preview/component/playwright-shared';

/** WCAG conformance levels supported as `spec` keyword presets. */
export type AxeSpec = 'wcag2a' | 'wcag2aa' | 'wcag21a' | 'wcag21aa' | 'wcag22aa' | 'best-practice' | 'all';

export interface AxeOptions {
  /**
   * Conformance preset that maps to axe's runOnly tags. Defaults to 'wcag21aa'
   * (WCAG 2.1 Level AA — the most common legal requirement).
   *  - 'wcag2a' / 'wcag2aa':   WCAG 2.0
   *  - 'wcag21a' / 'wcag21aa': WCAG 2.1
   *  - 'wcag22aa':             WCAG 2.2 Level AA
   *  - 'best-practice':        axe's curated best-practice rules
   *  - 'all':                  every WCAG and best-practice rule
   */
  spec?: AxeSpec;
  /**
   * Specific rule IDs to disable (passed to axe's `rules` option). Use this
   * for project-wide opt-outs; per-component opt-outs live on the component
   * declaration via `validation.skipRules`.
   */
  disableRules?: string[];
  /** Override axe's `runOnly.values` directly if you need a custom tag set. */
  tags?: string[];
}

interface AxeResultsShape {
  violations?: AxeRuleResult[];
  passes?: AxeRuleResult[];
  incomplete?: AxeRuleResult[];
  inapplicable?: AxeRuleResult[];
  testEngine?: { version?: string };
}

interface AxeRuleResult {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description?: string;
  help?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: AxeNodeResult[];
}

interface AxeNodeResult {
  target?: string[];
  html?: string;
  failureSummary?: string;
}

const TAG_PRESETS: Record<AxeSpec, string[]> = {
  wcag2a: ['wcag2a'],
  wcag2aa: ['wcag2a', 'wcag2aa'],
  wcag21a: ['wcag2a', 'wcag21a'],
  wcag21aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  wcag22aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  'best-practice': ['best-practice'],
  all: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
};

/** Resolve the axe-core script path lazily — keep the require off the
 *  top-level so projects without axe-core installed don't break on import. */
function resolveAxeSource(): { source: string; version: string } | { error: string } {
  try {
    const req = createRequire(import.meta.url);
    const axePackage = req('axe-core/package.json') as { version: string };
    const axePath = req.resolve('axe-core');
    // axe-core's main is dist/axe.js — a UMD bundle safe to inject.
    // We need to read the JS as a string to inject via page.evaluate.
    const dir = path.dirname(axePath);
    const candidates = [
      path.join(dir, 'axe.js'),
      path.join(dir, 'axe.min.js'),
      axePath, // fall back to whatever main resolves to
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return { source: fs.readFileSync(c, 'utf8'), version: axePackage.version };
      }
    }
    return { error: 'axe-core resolved but no axe.js or axe.min.js found in its dist' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `axe-core not installed (${msg}). Run \`npm i -D axe-core\` in your workspace.` };
  }
}

/** axe impact → ValidationFinding severity. critical/serious become errors,
 *  moderate becomes warning, minor (or missing) becomes info. */
function severityFromImpact(impact: AxeRuleResult['impact']): ValidationFinding['severity'] {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'error';
    case 'moderate':
      return 'warning';
    case 'minor':
    default:
      return 'info';
  }
}

function findingsFromViolations(violations: AxeRuleResult[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const v of violations) {
    const baseSeverity = severityFromImpact(v.impact);
    const nodes = v.nodes ?? [];
    if (nodes.length === 0) {
      findings.push({
        ruleId: `axe.${v.id}`,
        severity: baseSeverity,
        message: v.help ?? v.description ?? v.id,
        helpUrl: v.helpUrl,
        tags: v.tags,
      });
      continue;
    }
    // One finding per affected node so the UI can highlight each instance
    // separately. axe groups multiple nodes under one rule; we flatten so the
    // count matches what users actually see in the preview.
    for (const node of nodes) {
      findings.push({
        ruleId: `axe.${v.id}`,
        severity: baseSeverity,
        message: v.help ?? v.description ?? v.id,
        target: node.target?.join(' ') || undefined,
        snippet: node.html || undefined,
        helpUrl: v.helpUrl,
        tags: v.tags,
      });
    }
  }
  return findings;
}

async function runAxeOnPreview(
  input: ValidatorInput,
  opts: AxeOptions
): Promise<{ findings: ValidationFinding[]; engineVersion: string; durationMs: number } | { error: string }> {
  if (!input.previewPath) {
    return { error: 'no preview HTML on disk — run `handoff-app build:components` first' };
  }

  const axeSrc = resolveAxeSource();
  if ('error' in axeSrc) return { error: axeSrc.error };

  const opened = await openPreviewPage({
    workingPath: input.workingPath,
    previewPath: input.previewPath,
  });
  if ('error' in opened) return { error: opened.error };

  const startedAt = Date.now();
  try {
    // Inject axe into the page. addScriptTag with `content` lets us avoid
    // serving the script over a fake URL.
    await opened.page.addScriptTag({ content: axeSrc.source });

    const tags = opts.tags ?? TAG_PRESETS[opts.spec ?? 'wcag21aa'];
    const disableRules = opts.disableRules ?? [];

    // Execute axe in-page. The result object is passed back through JSON
    // serialization, so we can't transfer functions or DOM refs — just plain
    // data. axe.run resolves with the standard results shape.
    const results = (await opened.page.evaluate(
      async ({ tags, disableRules }) => {
        // axe-core attaches itself as window.axe.
        // We narrow the type loosely inside the page context.
        const axe = (window as unknown as { axe: { run: (root: unknown, opts: unknown) => Promise<unknown> } }).axe;
        const rules: Record<string, { enabled: boolean }> = {};
        for (const r of disableRules) rules[r] = { enabled: false };
        return await axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          rules,
          resultTypes: ['violations', 'incomplete'],
        });
      },
      { tags, disableRules }
    )) as AxeResultsShape;

    const findings = [
      ...findingsFromViolations(results.violations ?? []),
      // 'incomplete' = axe couldn't determine — surface as info so the user
      // can review manually rather than treating it as a hard pass.
      ...findingsFromViolations(results.incomplete ?? []).map<ValidationFinding>((f) => ({
        ...f,
        severity: 'info',
        message: `[needs review] ${f.message}`,
      })),
    ];

    return {
      findings,
      engineVersion: results.testEngine?.version ?? axeSrc.version,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `axe execution failed: ${msg}` };
  } finally {
    await opened.close();
  }
}

/**
 * Factory: build an axe-core validator with the given options.
 * Returns a Validator object compatible with config.validation.validators.
 */
export function axe(opts: AxeOptions = {}): Validator {
  return {
    id: 'axe',
    name: 'Accessibility (axe-core)',
    description: 'WCAG accessibility checks via axe-core',
    helpUrl: 'https://www.deque.com/axe/core-documentation/',
    async run(input) {
      const startedAt = Date.now();
      const outcome = await runAxeOnPreview(input, opts);
      if ('error' in outcome) {
        return {
          validatorId: 'axe',
          validatorName: 'Accessibility (axe-core)',
          status: 'fail',
          severity: 'error',
          findings: [
            {
              ruleId: 'axe.runtime-error',
              severity: 'error',
              message: outcome.error,
            },
          ],
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          summary: outcome.error,
        } satisfies ValidatorResult;
      }

      const findings = outcome.findings;
      const severity =
        findings.some((f) => f.severity === 'error')
          ? 'error'
          : findings.some((f) => f.severity === 'warning')
            ? 'warning'
            : findings.some((f) => f.severity === 'info')
              ? 'info'
              : 'pass';
      const errorCount = findings.filter((f) => f.severity === 'error').length;
      const warnCount = findings.filter((f) => f.severity === 'warning').length;
      return {
        validatorId: 'axe',
        validatorName: 'Accessibility (axe-core)',
        status: severity === 'pass' ? 'pass' : 'fail',
        severity,
        findings,
        runAt: new Date().toISOString(),
        durationMs: outcome.durationMs,
        engineVersion: outcome.engineVersion,
        summary:
          severity === 'pass'
            ? 'No accessibility violations.'
            : `${errorCount} error, ${warnCount} warning — ${findings.length} total finding(s).`,
      } satisfies ValidatorResult;
    },
  };
}
