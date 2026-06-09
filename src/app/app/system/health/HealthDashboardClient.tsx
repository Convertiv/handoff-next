'use client';
import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { HealthSummary, ValidationManifest } from './health-types';
import type { ValidationRunRecord } from '@/lib/db/validation-queries';
import { ScoreBadge } from './ScoreBadge';
import { ValidatorBreakdownBars } from './ValidatorBreakdownBars';
import { TrendChart } from './TrendChart';
import { ComponentHealthTable } from './ComponentHealthTable';
import { RuleBreakdownTable } from './RuleBreakdownTable';

interface HealthDashboardClientProps {
  summary: HealthSummary;
  manifest: ValidationManifest;
  history: ValidationRunRecord[];
}

type Tab = 'components' | 'rules';

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function HealthDashboardClient({ summary, manifest, history }: HealthDashboardClientProps) {
  const [tab, setTab] = useState<Tab>('components');

  const lastChecked = summary.lastRunAt
    ? new Date(summary.lastRunAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <div className="flex flex-wrap items-start gap-6 rounded-2xl border bg-card p-6">
        {/* Grade ring */}
        <ScoreBadge score={summary.score} grade={summary.grade} size="lg" />

        {/* KPIs */}
        <div className="flex-1 space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Passing"
              value={`${summary.validatedComponents - (summary.componentRows.filter(r => r.worstSeverity === 'error').length)} / ${summary.validatedComponents}`}
              sub={`${summary.notRunComponents} not yet run`}
              accent="text-green-600"
            />
            <KpiCard
              label="Errors"
              value={summary.totalErrors}
              sub={`${summary.componentRows.filter(r => r.worstSeverity === 'error').length} components`}
              accent={summary.totalErrors > 0 ? 'text-red-600' : undefined}
            />
            <KpiCard
              label="Warnings"
              value={summary.totalWarnings}
              sub={`${summary.componentRows.filter(r => r.worstSeverity === 'warning').length} components`}
              accent={summary.totalWarnings > 0 ? 'text-amber-600' : undefined}
            />
            <KpiCard
              label="Last checked"
              value={summary.lastRunAt ? new Date(summary.lastRunAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
              sub={summary.lastRunAt ? new Date(summary.lastRunAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'Run push:all'}
            />
          </div>

          {/* Validator breakdown bars */}
          {summary.validatorBreakdown.length > 0 && (
            <ValidatorBreakdownBars breakdown={summary.validatorBreakdown} />
          )}
        </div>

        {/* Trend chart */}
        {history.length >= 2 && (
          <div className="w-64 shrink-0">
            <TrendChart runs={history} />
          </div>
        )}
      </div>

      {/* Not-run callout */}
      {summary.notRunComponents > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <span className="font-medium text-amber-800 dark:text-amber-300">
              {summary.notRunComponents} component{summary.notRunComponents !== 1 ? 's' : ''} haven't been validated yet.
            </span>
            <span className="ml-1 text-amber-700 dark:text-amber-400">
              Run <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">handoff-app push:all</code> to populate results.
            </span>
          </div>
        </div>
      )}

      {/* All-clear banner */}
      {summary.totalErrors === 0 && summary.totalWarnings === 0 && summary.validatedComponents > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm dark:border-green-900/40 dark:bg-green-950/20">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <span className="font-medium text-green-800 dark:text-green-300">
            All {summary.validatedComponents} validated components are passing. Great work! 🎉
          </span>
        </div>
      )}

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b mb-4">
          {([
            { key: 'components', label: `By Component (${summary.totalComponents})` },
            { key: 'rules', label: `By Rule (${summary.ruleRows.length})` },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'components' && (
          <ComponentHealthTable rows={summary.componentRows} manifest={manifest} />
        )}
        {tab === 'rules' && (
          <RuleBreakdownTable rules={summary.ruleRows} />
        )}
      </div>
    </div>
  );
}
