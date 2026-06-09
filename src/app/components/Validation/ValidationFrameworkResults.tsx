'use client';

import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info, MinusCircle } from 'lucide-react';
import React, { useState } from 'react';
import type { ValidatorResult, ValidationFinding } from '@handoff/types/validation';
import { Badge } from '../ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

/**
 * Registry-side renderer for ADR-002 validation results.
 *
 * Renders one card per validator with:
 *  - Status icon + name + summary + severity badge
 *  - Counts of error / warning / info findings
 *  - Expandable list of every finding, each with target selector, snippet,
 *    and help URL when present.
 *
 * Designed to be wired into the component detail page alongside the existing
 * (legacy) per-preview ValidationResults. The two coexist during the
 * transition — once projects move to the new framework, the legacy slice
 * stops getting populated and falls off naturally.
 */

export interface ValidationFrameworkResultsProps {
  results: ValidatorResult[];
}

function statusIcon(result: ValidatorResult): React.ReactElement {
  if (result.status === 'skipped') return <MinusCircle className="h-4 w-4 text-slate-400" aria-label="skipped" />;
  if (result.severity === 'error') return <AlertCircle className="h-4 w-4 text-red-500" aria-label="error" />;
  if (result.severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="warning" />;
  if (result.severity === 'info') return <Info className="h-4 w-4 text-sky-500" aria-label="info" />;
  return <CheckCircle2 className="h-4 w-4 text-green-500" aria-label="pass" />;
}

function severityBadge(result: ValidatorResult): React.ReactElement {
  if (result.status === 'skipped') {
    return <Badge variant="outline">Skipped</Badge>;
  }
  if (result.severity === 'pass') return <Badge variant="green">Passed</Badge>;
  if (result.severity === 'error') return <Badge variant="destructive">{result.findings.length} issue(s)</Badge>;
  if (result.severity === 'warning') return <Badge variant="warning">{result.findings.length} warning(s)</Badge>;
  return <Badge variant="outline">{result.findings.length} note(s)</Badge>;
}

function findingSeverityIcon(severity: ValidationFinding['severity']): React.ReactElement {
  if (severity === 'error') return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  if (severity === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-sky-500" />;
}

/** Roll-up counts across all validators for the page-header summary line. */
function rollup(results: ValidatorResult[]): { errors: number; warnings: number; infos: number; passed: number; skipped: number } {
  let errors = 0, warnings = 0, infos = 0, passed = 0, skipped = 0;
  for (const r of results) {
    if (r.status === 'skipped') { skipped++; continue; }
    if (r.severity === 'pass') passed++;
    for (const f of r.findings) {
      if (f.severity === 'error') errors++;
      else if (f.severity === 'warning') warnings++;
      else infos++;
    }
  }
  return { errors, warnings, infos, passed, skipped };
}

export const ValidationFrameworkResults: React.FC<ValidationFrameworkResultsProps> = ({ results }) => {
  if (!Array.isArray(results) || results.length === 0) return null;
  const totals = rollup(results);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{results.length} validator{results.length === 1 ? '' : 's'} ran</span>
        <span aria-hidden>·</span>
        {totals.errors > 0 && <span className="text-red-600">{totals.errors} error{totals.errors === 1 ? '' : 's'}</span>}
        {totals.warnings > 0 && <span className="text-amber-600">{totals.warnings} warning{totals.warnings === 1 ? '' : 's'}</span>}
        {totals.infos > 0 && <span className="text-sky-600">{totals.infos} info</span>}
        {totals.passed > 0 && <span className="text-green-700">{totals.passed} passed</span>}
        {totals.skipped > 0 && <span className="text-slate-500">{totals.skipped} skipped</span>}
        {totals.errors === 0 && totals.warnings === 0 && totals.infos === 0 && totals.passed === results.length && (
          <span className="text-green-700">All checks passed</span>
        )}
      </div>
      {results.map((r) => (
        <ValidatorCard key={r.validatorId} result={r} />
      ))}
    </div>
  );
};

const ValidatorCard: React.FC<{ result: ValidatorResult }> = ({ result }) => {
  // Start expanded if there are findings; pass results stay collapsed by
  // default to keep the page scannable.
  const [open, setOpen] = useState(result.findings.length > 0 && result.severity !== 'pass');

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {statusIcon(result)}
          <div className="flex min-w-0 flex-col items-start text-left">
            <span className="truncate font-medium">{result.validatorName}</span>
            {result.summary && (
              <span className="truncate text-xs text-muted-foreground">{result.summary}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {severityBadge(result)}
          {result.findings.length > 0 && (
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          )}
        </div>
      </CollapsibleTrigger>
      {result.findings.length > 0 && (
        <CollapsibleContent className="mt-3 space-y-2 border-t pt-3">
          {result.findings.map((f, idx) => (
            <FindingRow key={`${result.validatorId}-${idx}`} finding={f} />
          ))}
        </CollapsibleContent>
      )}
      {result.status === 'skipped' && result.skipReason && (
        <p className="mt-2 text-xs italic text-muted-foreground">Skipped: {result.skipReason}</p>
      )}
    </Collapsible>
  );
};

const FindingRow: React.FC<{ finding: ValidationFinding }> = ({ finding }) => {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-sm">
      <div className="mt-0.5">{findingSeverityIcon(finding.severity)}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{finding.ruleId}</code>
          {finding.helpUrl && (
            <a
              href={finding.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-600 hover:underline"
            >
              docs ↗
            </a>
          )}
        </div>
        <p className="text-sm leading-snug">{finding.message}</p>
        {finding.target && (
          <p className="text-xs text-muted-foreground">
            <span className="text-[11px] uppercase tracking-wide opacity-60">at </span>
            <code className="font-mono">{finding.target}</code>
          </p>
        )}
        {finding.snippet && (
          <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] leading-tight">
            <code>{finding.snippet}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

export default ValidationFrameworkResults;
