'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, Clock } from 'lucide-react';
import type { ComponentHealthRow, ValidationManifest } from './health-types';
import { ValidationFrameworkResults } from '@/components/Validation/ValidationFrameworkResults';
import type { ValidatorResult } from '@handoff/types/validation';

interface ComponentHealthTableProps {
  rows: ComponentHealthRow[];
  manifest: ValidationManifest | null;
}

type SortKey = 'severity' | 'title' | 'score' | 'errors';
type SortDir = 'asc' | 'desc';

const SEV_ORDER = { error: 0, warning: 1, pass: 2, skipped: 3, none: 4 };

function SeverityIcon({ sev }: { sev: ComponentHealthRow['worstSeverity'] }) {
  if (sev === 'error') return <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />;
  if (sev === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
  if (sev === 'pass') return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />;
  if (sev === 'skipped') return <MinusCircle className="h-4 w-4 shrink-0 text-slate-400" />;
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
}

function ValidatorChip({ result }: { result: ValidatorResult | undefined }) {
  if (!result) return <span className="inline-block h-2 w-2 rounded-full bg-muted" title="Not run" />;
  if (result.status === 'skipped') return <span className="inline-block h-2 w-2 rounded-full bg-slate-300" title="Skipped" />;
  if (result.severity === 'error') return <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={`${result.findings.length} error(s)`} />;
  if (result.severity === 'warning') return <span className="inline-block h-2 w-2 rounded-full bg-amber-400" title={`${result.findings.length} warning(s)`} />;
  return <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Pass" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ComponentHealthTable({ rows, manifest }: ComponentHealthTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'severity', dir: 'asc' });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings' | 'passing'>('all');

  const validatorIds = manifest?.validators.map((v) => v.id) ?? [];

  // Filter
  const filtered = rows.filter((r) => {
    if (filter === 'errors') return r.worstSeverity === 'error';
    if (filter === 'warnings') return r.worstSeverity === 'warning';
    if (filter === 'passing') return r.worstSeverity === 'pass';
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'severity') cmp = (SEV_ORDER[a.worstSeverity] ?? 4) - (SEV_ORDER[b.worstSeverity] ?? 4);
    else if (sort.key === 'title') cmp = a.title.localeCompare(b.title);
    else if (sort.key === 'score') cmp = a.score - b.score;
    else if (sort.key === 'errors') cmp = a.errorCount - b.errorCount;
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  // Group by component group
  const groups = new Map<string, ComponentHealthRow[]>();
  for (const r of sorted) {
    const g = r.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGroup(g: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }
  function cycleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  }
  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = sort.key === k;
    return (
      <button onClick={() => cycleSort(k)} className={`flex items-center gap-0.5 text-xs font-medium hover:text-foreground ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
        {active && <span className="text-[10px]">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex gap-2">
        {(['all', 'errors', 'warnings', 'passing'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${filter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table header */}
      <div className="grid items-center gap-2 border-b pb-2 text-xs text-muted-foreground"
        style={{ gridTemplateColumns: '1.5rem 1fr auto auto auto' }}>
        <span />
        <SortHeader label="Component" k="title" />
        <span className="flex gap-1.5">
          {validatorIds.length > 0
            ? validatorIds.map((id) => <span key={id} className="w-2 text-center" title={id}>·</span>)
            : <SortHeader label="Score" k="score" />}
        </span>
        <SortHeader label="Issues" k="errors" />
        <span>Last run</span>
      </div>

      {/* Grouped rows */}
      {[...groups.entries()].map(([group, groupRows]) => (
        <div key={group}>
          {/* Group header */}
          <button
            onClick={() => toggleGroup(group)}
            className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {collapsedGroups.has(group)
              ? <ChevronRight className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
            {group}
            <span className="ml-1 font-normal opacity-60">({groupRows.length})</span>
          </button>

          {!collapsedGroups.has(group) && (
            <div className="divide-y rounded-md border">
              {groupRows.map((row) => {
                const expanded = expandedIds.has(row.id);
                const hasResults = Object.keys(row.validatorResults).length > 0;
                return (
                  <div key={row.id}>
                    <div
                      className="grid cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                      style={{ gridTemplateColumns: '1.5rem 1fr auto auto auto' }}
                      onClick={() => hasResults && toggleExpand(row.id)}
                    >
                      <SeverityIcon sev={row.worstSeverity} />
                      <div className="min-w-0">
                        <Link
                          href={row.path}
                          className="truncate text-sm font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.title}
                        </Link>
                      </div>
                      {/* Per-validator dots */}
                      <div className="flex items-center gap-2">
                        {validatorIds.length > 0
                          ? validatorIds.map((id) => (
                              <ValidatorChip key={id} result={row.validatorResults[id]} />
                            ))
                          : <span className="tabular-nums text-xs">{row.score.toFixed(0)}</span>}
                      </div>
                      {/* Issue count */}
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {row.errorCount > 0 && <span className="text-red-500 font-medium">{row.errorCount}e </span>}
                        {row.warningCount > 0 && <span className="text-amber-500">{row.warningCount}w</span>}
                        {row.errorCount === 0 && row.warningCount === 0 && row.lastRunAt && (
                          <span className="text-green-600">✓</span>
                        )}
                        {!row.lastRunAt && <span className="opacity-40">—</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {row.lastRunAt ? timeAgo(row.lastRunAt) : '—'}
                      </span>
                    </div>
                    {/* Inline expansion */}
                    {expanded && hasResults && (
                      <div className="border-t bg-muted/20 px-4 py-3">
                        <ValidationFrameworkResults
                          results={Object.values(row.validatorResults) as ValidatorResult[]}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No components match this filter.</p>
      )}
    </div>
  );
}
