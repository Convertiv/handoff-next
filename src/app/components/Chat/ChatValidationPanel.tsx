'use client';

import { useEffect, useState } from 'react';
import { XCircle, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@handoff/app/components/ui/button';
import { handoffApiUrl } from '@/lib/api-path';

interface ValidationFinding {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  target?: string;
  snippet?: string;
}

interface ValidatorResult {
  validatorId: string;
  validatorName: string;
  status: 'pass' | 'fail' | 'skipped';
  severity: 'error' | 'warning' | 'info' | 'pass' | 'skipped';
  findings: ValidationFinding[];
  summary?: string;
  skipReason?: string;
}

interface Props {
  componentId: string;
  componentTitle: string;
  basePath?: string;
  onNavigate?: () => void;
}

function SeverityIcon({ s }: { s: string }) {
  if (s === 'error') return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
  if (s === 'warning') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  if (s === 'info') return <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
}

function ValidatorBlock({ result }: { result: ValidatorResult }) {
  const [open, setOpen] = useState(true);
  if (result.status === 'pass') {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{result.validatorName}</span>
      </div>
    );
  }
  if (result.status === 'skipped') {
    return (
      <div className="py-1 text-xs italic text-muted-foreground">
        {result.validatorName}: skipped{result.skipReason ? ` — ${result.skipReason}` : ''}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-1 text-xs font-medium hover:text-foreground text-left"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="flex-1">{result.validatorName}</span>
        <span className="text-[10px] text-muted-foreground">{result.findings.length} issue{result.findings.length !== 1 ? 's' : ''}</span>
      </button>
      {open && result.findings.length > 0 && (
        <div className="ml-4 space-y-1.5 pb-2">
          {result.findings.map((f, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-start gap-1.5">
                <SeverityIcon s={f.severity} />
                <p className="text-xs leading-relaxed">{f.message}</p>
              </div>
              {f.target && (
                <code className="ml-5 block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {f.target}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatValidationPanel({ componentId, componentTitle, basePath, onNavigate }: Props) {
  const [results, setResults] = useState<ValidatorResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(handoffApiUrl(`/api/handoff/components/validation?id=${encodeURIComponent(componentId)}`), {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: ValidatorResult[] };
        setResults(data.results ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load validation'))
      .finally(() => setLoading(false));
  }, [componentId]);

  const totalErrors = results.flatMap((r) => r.findings).filter((f) => f.severity === 'error').length;
  const totalWarnings = results.flatMap((r) => r.findings).filter((f) => f.severity === 'warning').length;
  const allPassed = results.length > 0 && results.every((r) => r.status === 'pass' || r.status === 'skipped');

  const failing = results.filter((r) => r.status === 'fail');
  const passing = results.filter((r) => r.status === 'pass');
  const skipped = results.filter((r) => r.status === 'skipped');

  return (
    <div className="mt-2 w-full rounded-xl border border-border bg-card p-3">
      {/* Header */}
      <p className="mb-2 text-xs font-semibold">{componentTitle} — validation</p>

      {loading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-muted" />)}
        </div>
      )}

      {!loading && error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && !error && results.length === 0 && (
        <p className="text-xs italic text-muted-foreground">No validation data available for this component.</p>
      )}

      {!loading && !error && results.length > 0 && (
        <>
          {allPassed ? (
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-green-50 px-2 py-1.5 dark:bg-green-950/30">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              <span className="text-xs font-medium text-green-700 dark:text-green-400">All checks passed</span>
            </div>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">
              {totalErrors > 0 && <span className="text-red-600 font-medium">{totalErrors} error{totalErrors !== 1 ? 's' : ''}</span>}
              {totalErrors > 0 && totalWarnings > 0 && <span> · </span>}
              {totalWarnings > 0 && <span className="text-amber-600 font-medium">{totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}</span>}
            </p>
          )}
          <div className="divide-y divide-border/50">
            {[...failing, ...passing, ...skipped].map((r) => (
              <ValidatorBlock key={r.validatorId} result={r} />
            ))}
          </div>
        </>
      )}

      {onNavigate && (
        <Button variant="ghost" size="sm" className="mt-2 h-7 w-full text-xs" onClick={onNavigate}>
          View component details →
        </Button>
      )}
    </div>
  );
}
