import { desc } from 'drizzle-orm';
import { getDb } from './index';
import { handoffValidationRuns } from './schema';

export interface ValidationRunRecord {
  id: number;
  runAt: Date;
  trigger: string;
  score: number | null;
  grade: string | null;
  totalComponents: number;
  validatedComponents: number;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
  passedValidators: number;
  skippedValidators: number;
  validatorBreakdown: ValidatorBreakdownEntry[];
  componentSnapshot: ComponentSnapshotEntry[];
}

export interface ValidatorBreakdownEntry {
  id: string;
  name: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ComponentSnapshotEntry {
  id: string;
  title: string;
  score: number;
  severity: 'pass' | 'warning' | 'error' | 'skipped' | 'none';
}

export async function insertValidationRun(
  run: Omit<ValidationRunRecord, 'id'>
): Promise<void> {
  const db = getDb();
  await db.insert(handoffValidationRuns).values({
    runAt: run.runAt,
    trigger: run.trigger,
    score: run.score != null ? String(run.score) : null,
    grade: run.grade,
    totalComponents: run.totalComponents,
    validatedComponents: run.validatedComponents,
    totalErrors: run.totalErrors,
    totalWarnings: run.totalWarnings,
    totalInfos: run.totalInfos,
    passedValidators: run.passedValidators,
    skippedValidators: run.skippedValidators,
    validatorBreakdown: run.validatorBreakdown,
    componentSnapshot: run.componentSnapshot,
  });
}

export async function getValidationRunHistory(limit = 30): Promise<ValidationRunRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffValidationRuns)
    .orderBy(desc(handoffValidationRuns.runAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    runAt: r.runAt as Date,
    trigger: r.trigger,
    score: r.score != null ? Number(r.score) : null,
    grade: r.grade,
    totalComponents: r.totalComponents,
    validatedComponents: r.validatedComponents,
    totalErrors: r.totalErrors,
    totalWarnings: r.totalWarnings,
    totalInfos: r.totalInfos,
    passedValidators: r.passedValidators,
    skippedValidators: r.skippedValidators,
    validatorBreakdown: (r.validatorBreakdown ?? []) as ValidatorBreakdownEntry[],
    componentSnapshot: (r.componentSnapshot ?? []) as ComponentSnapshotEntry[],
  }));
}
