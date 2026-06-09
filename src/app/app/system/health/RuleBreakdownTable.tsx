'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { RuleRow } from './health-types';
import { Badge } from '@/components/ui/badge';

interface RuleBreakdownTableProps {
  rules: RuleRow[];
}

function SeverityIcon({ sev }: { sev: RuleRow['severity'] }) {
  if (sev === 'error') return <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />;
  if (sev === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
  return <Info className="h-4 w-4 shrink-0 text-sky-500" />;
}

export function RuleBreakdownTable({ rules }: RuleBreakdownTableProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

  const filtered = rules.filter((r) => filter === 'all' || r.severity === filter);

  function toggle(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex gap-2">
        {(['all', 'error', 'warning', 'info'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${filter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {rules.length === 0
            ? 'No rule violations found across the system. 🎉'
            : 'No rules match this filter.'}
        </p>
      )}

      <div className="divide-y rounded-md border">
        {filtered.map((rule) => {
          const key = `${rule.validatorId}::${rule.ruleId}`;
          const expanded = expandedKeys.has(key);
          return (
            <div key={key}>
              <div
                className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                onClick={() => toggle(key)}
              >
                <div className="mt-0.5">
                  <SeverityIcon sev={rule.severity} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{rule.ruleId}</code>
                    <span className="text-xs text-muted-foreground">{rule.validatorName}</span>
                    {rule.helpUrl && (
                      <a
                        href={rule.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sky-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        docs ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={rule.severity === 'error' ? 'destructive' : rule.severity === 'warning' ? 'warning' : 'outline'}>
                    {rule.affectedComponents.length} component{rule.affectedComponents.length !== 1 ? 's' : ''}
                  </Badge>
                  {expanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>

              {expanded && (
                <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
                  {rule.affectedComponents.map((comp) => (
                    <div key={comp.id} className="rounded-md bg-card p-2.5 text-sm space-y-1">
                      <div className="flex items-baseline gap-2">
                        <Link href={comp.path} className="font-medium hover:underline">
                          {comp.title}
                        </Link>
                        {comp.target && (
                          <code className="text-[11px] font-mono text-muted-foreground">{comp.target}</code>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{comp.message}</p>
                      {comp.snippet && (
                        <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] leading-tight">
                          <code>{comp.snippet}</code>
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
