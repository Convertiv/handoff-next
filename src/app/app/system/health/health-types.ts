/**
 * Health dashboard types and pure computation helpers.
 *
 * These run on the server (page.tsx builds the summary) and can be imported
 * by the sync upload route (to record a run snapshot). No React or DB imports
 * here — keep this a plain .ts module.
 */

import type { ValidatorResult } from '@handoff/types/validation';
import type { ValidatorBreakdownEntry, ComponentSnapshotEntry, ValidationRunRecord } from '@/lib/db/validation-queries';

// ─── Manifest ────────────────────────────────────────────────────────────────

/** Pushed from workspace via pushRegistryConfig(). Stored under
 *  handoff_registry_config.data.validationManifest */
export interface ValidationManifest {
  configured: boolean;
  validators: Array<{ id: string; name: string; description?: string }>;
  runOn: 'push' | 'build' | 'manual';
}

// ─── Per-component row ────────────────────────────────────────────────────────

export type ComponentSeverity = 'pass' | 'warning' | 'error' | 'skipped' | 'none';

/** One row in the "by component" table. */
export interface ComponentHealthRow {
  id: string;
  title: string;
  group: string;
  image?: string;
  path: string;
  /** Map of validatorId → result (undefined = not run for this component). */
  validatorResults: Record<string, ValidatorResult>;
  /** Worst severity across all validators for this component. */
  worstSeverity: ComponentSeverity;
  /** Total finding counts. */
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** 0–100 score for this component. */
  score: number;
  /** ISO timestamp of most recent run, or null if never run. */
  lastRunAt: string | null;
}

// ─── Per-rule pivot ───────────────────────────────────────────────────────────

/** One row in the "by rule" table — a rule that appears across multiple components. */
export interface RuleRow {
  ruleId: string;
  validatorId: string;
  validatorName: string;
  severity: 'error' | 'warning' | 'info';
  helpUrl?: string;
  /** Components affected by this rule, with the specific finding. */
  affectedComponents: Array<{
    id: string;
    title: string;
    path: string;
    message: string;
    target?: string;
    snippet?: string;
  }>;
}

// ─── Page-level summary ───────────────────────────────────────────────────────

export interface HealthSummary {
  score: number;
  grade: string;
  totalComponents: number;
  validatedComponents: number;
  notRunComponents: number;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
  passedValidators: number;
  skippedValidators: number;
  /** Per-validator cross-system breakdown. */
  validatorBreakdown: ValidatorBreakdownEntry[];
  /** Flat list of component rows, sorted by worst severity then title. */
  componentRows: ComponentHealthRow[];
  /** All unique rules seen across components, sorted by affected count desc. */
  ruleRows: RuleRow[];
  /** Latest run timestamp, or null if never run. */
  lastRunAt: string | null;
}

// ─── Score / grade helpers ────────────────────────────────────────────────────

/**
 * Per-component score: start at 100, subtract per failing validator.
 *   error-severity validator result → -25
 *   warning-severity validator result → -8
 * Clamped to 0–100. Components with no results score null (not counted).
 */
export function scoreComponent(results: ValidatorResult[]): number {
  let s = 100;
  for (const r of results) {
    if (r.status === 'skipped') continue;
    if (r.severity === 'error') s -= 25;
    else if (r.severity === 'warning') s -= 8;
  }
  return Math.max(0, Math.min(100, s));
}

export function gradeFromScore(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A−';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B−';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C−';
  if (score >= 67) return 'D+';
  if (score >= 60) return 'D';
  return 'F';
}

export function gradeColor(grade: string): string {
  const first = grade[0];
  if (first === 'A') return 'text-green-600';
  if (first === 'B') return 'text-sky-600';
  if (first === 'C') return 'text-amber-600';
  return 'text-red-600';
}

function worstSeverity(results: ValidatorResult[]): ComponentSeverity {
  if (results.length === 0) return 'none';
  if (results.every((r) => r.status === 'skipped')) return 'skipped';
  if (results.some((r) => r.severity === 'error')) return 'error';
  if (results.some((r) => r.severity === 'warning')) return 'warning';
  return 'pass';
}

const SEVERITY_SORT: Record<ComponentSeverity, number> = {
  error: 0, warning: 1, pass: 2, skipped: 3, none: 4,
};

// ─── Main computation ─────────────────────────────────────────────────────────

export interface ComponentInput {
  id: string;
  title: string;
  group?: string;
  image?: string;
  path?: string;
  validationResults?: ValidatorResult[];
}

export function computeHealthSummary(
  components: ComponentInput[],
  manifest: ValidationManifest | null
): HealthSummary {
  const componentRows: ComponentHealthRow[] = [];
  const ruleMap = new Map<string, RuleRow>();

  let totalErrors = 0, totalWarnings = 0, totalInfos = 0;
  let passedValidators = 0, skippedValidators = 0;
  let validatedComponents = 0;
  const validatorTotals = new Map<string, { id: string; name: string; passed: number; failed: number; skipped: number }>();

  // Seed from manifest so we show expected validators even if no data yet
  if (manifest) {
    for (const v of manifest.validators) {
      validatorTotals.set(v.id, { id: v.id, name: v.name, passed: 0, failed: 0, skipped: 0 });
    }
  }

  for (const c of components) {
    const results = c.validationResults ?? [];
    const validatorResults: Record<string, ValidatorResult> = {};

    if (results.length > 0) validatedComponents++;

    let cErrors = 0, cWarnings = 0, cInfos = 0;

    for (const r of results) {
      validatorResults[r.validatorId] = r;

      // Validator totals
      if (!validatorTotals.has(r.validatorId)) {
        validatorTotals.set(r.validatorId, { id: r.validatorId, name: r.validatorName, passed: 0, failed: 0, skipped: 0 });
      }
      const vt = validatorTotals.get(r.validatorId)!;
      if (r.status === 'skipped') { vt.skipped++; skippedValidators++; }
      else if (r.severity === 'pass') { vt.passed++; passedValidators++; }
      else vt.failed++;

      // Finding counts
      for (const f of r.findings) {
        if (f.severity === 'error') { cErrors++; totalErrors++; }
        else if (f.severity === 'warning') { cWarnings++; totalWarnings++; }
        else { cInfos++; totalInfos++; }

        // Rule pivot
        const key = `${r.validatorId}::${f.ruleId}`;
        if (!ruleMap.has(key)) {
          ruleMap.set(key, {
            ruleId: f.ruleId,
            validatorId: r.validatorId,
            validatorName: r.validatorName,
            severity: f.severity,
            helpUrl: f.helpUrl,
            affectedComponents: [],
          });
        }
        const row = ruleMap.get(key)!;
        // Escalate severity if needed
        if (f.severity === 'error') row.severity = 'error';
        else if (f.severity === 'warning' && row.severity === 'info') row.severity = 'warning';

        // Only add each component once per rule
        if (!row.affectedComponents.find((a) => a.id === c.id)) {
          row.affectedComponents.push({
            id: c.id,
            title: c.title,
            path: c.path ?? `/system/component/${c.id}`,
            message: f.message,
            target: f.target,
            snippet: f.snippet,
          });
        }
      }
    }

    componentRows.push({
      id: c.id,
      title: c.title,
      group: c.group ?? '',
      image: c.image,
      path: c.path ?? `/system/component/${c.id}`,
      validatorResults,
      worstSeverity: worstSeverity(results),
      errorCount: cErrors,
      warningCount: cWarnings,
      infoCount: cInfos,
      score: results.length > 0 ? scoreComponent(results) : 100,
      lastRunAt: results.length > 0
        ? results.reduce<string | null>((latest, r) => {
            if (!latest) return r.runAt;
            return r.runAt > latest ? r.runAt : latest;
          }, null)
        : null,
    });
  }

  // Sort: worst severity first, then by title
  componentRows.sort((a, b) => {
    const sd = SEVERITY_SORT[a.worstSeverity] - SEVERITY_SORT[b.worstSeverity];
    return sd !== 0 ? sd : a.title.localeCompare(b.title);
  });

  const ruleRows = [...ruleMap.values()].sort((a, b) => {
    // Errors first, then by affected count desc
    if (a.severity !== b.severity) {
      const sev: Record<string, number> = { error: 0, warning: 1, info: 2 };
      return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
    }
    return b.affectedComponents.length - a.affectedComponents.length;
  });

  const validatorBreakdown: ValidatorBreakdownEntry[] = [...validatorTotals.values()];

  const scoredRows = componentRows.filter((r) => r.lastRunAt !== null);
  const avgScore = scoredRows.length > 0
    ? scoredRows.reduce((sum, r) => sum + r.score, 0) / scoredRows.length
    : 100;
  const score = Math.round(avgScore * 10) / 10;
  const grade = gradeFromScore(score);

  const lastRunAt = componentRows.reduce<string | null>((latest, r) => {
    if (!r.lastRunAt) return latest;
    if (!latest) return r.lastRunAt;
    return r.lastRunAt > latest ? r.lastRunAt : latest;
  }, null);

  return {
    score,
    grade,
    totalComponents: components.length,
    validatedComponents,
    notRunComponents: components.length - validatedComponents,
    totalErrors,
    totalWarnings,
    totalInfos,
    passedValidators,
    skippedValidators,
    validatorBreakdown,
    componentRows,
    ruleRows,
    lastRunAt,
  };
}

/** Convert a HealthSummary to the compact shape stored in handoff_validation_run. */
export function summaryToRunRecord(
  summary: HealthSummary,
  trigger: 'push' | 'manual' = 'push'
): Omit<ValidationRunRecord, 'id'> {
  return {
    runAt: new Date(),
    trigger,
    score: summary.score,
    grade: summary.grade,
    totalComponents: summary.totalComponents,
    validatedComponents: summary.validatedComponents,
    totalErrors: summary.totalErrors,
    totalWarnings: summary.totalWarnings,
    totalInfos: summary.totalInfos,
    passedValidators: summary.passedValidators,
    skippedValidators: summary.skippedValidators,
    validatorBreakdown: summary.validatorBreakdown,
    componentSnapshot: summary.componentRows.map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score,
      severity: r.worstSeverity,
    })),
  };
}
