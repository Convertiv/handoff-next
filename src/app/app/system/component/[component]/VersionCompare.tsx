'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { diffLines, diffStat, textChanged, type DiffOp } from '@handoff/utils/line-diff';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@handoff/app/components/ui/select';

// ─── Snapshot shape (full version record, fetched on demand) ─────────────────

interface FullSnapshot {
  title?: string;
  description?: string | null;
  group?: string | null;
  path?: string | null;
  type?: string | null;
  properties?: unknown;
  previews?: unknown;
  data?: {
    code?: string;
    html?: string;
    css?: string;
    sass?: string;
    usage?: string;
  } | null;
}

interface FullVersion {
  versionNumber: number;
  snapshot: FullSnapshot;
}

// ─── Field catalog — what we diff and how ────────────────────────────────────

type FieldKind = 'meta' | 'text' | 'json';
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  get: (s: FullSnapshot) => string;
}

function jsonText(val: unknown): string {
  if (val == null) return '';
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

const FIELDS: FieldDef[] = [
  { key: 'title', label: 'Title', kind: 'meta', get: (s) => s.title ?? '' },
  { key: 'description', label: 'Description', kind: 'meta', get: (s) => s.description ?? '' },
  { key: 'group', label: 'Group', kind: 'meta', get: (s) => s.group ?? '' },
  { key: 'type', label: 'Type', kind: 'meta', get: (s) => s.type ?? '' },
  { key: 'path', label: 'Path', kind: 'meta', get: (s) => s.path ?? '' },
  { key: 'properties', label: 'Properties (contract)', kind: 'json', get: (s) => jsonText(s.properties) },
  { key: 'previews', label: 'Previews', kind: 'json', get: (s) => jsonText(s.previews) },
  { key: 'code', label: 'Code', kind: 'text', get: (s) => s.data?.code ?? '' },
  { key: 'html', label: 'HTML', kind: 'text', get: (s) => s.data?.html ?? '' },
  { key: 'css', label: 'CSS', kind: 'text', get: (s) => s.data?.css ?? '' },
  { key: 'sass', label: 'SCSS', kind: 'text', get: (s) => s.data?.sass ?? '' },
  { key: 'usage', label: 'Usage', kind: 'text', get: (s) => s.data?.usage ?? '' },
];

// ─── Diff rendering ──────────────────────────────────────────────────────────

function DiffBlock({ ops }: { ops: DiffOp[] }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/20 p-0 text-[11px] leading-5">
      <code className="block font-mono">
        {ops.map((op, i) => (
          <span
            key={i}
            className={
              op.type === 'add'
                ? 'block bg-green-500/10 text-green-700 dark:text-green-400'
                : op.type === 'del'
                  ? 'block bg-red-500/10 text-red-700 dark:text-red-400'
                  : 'block text-muted-foreground'
            }
          >
            <span className="select-none pr-2 pl-2 opacity-50">
              {op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}
            </span>
            {op.text || ' '}
          </span>
        ))}
      </code>
    </pre>
  );
}

function FieldDiff({ field, oldVal, newVal }: { field: FieldDef; oldVal: string; newVal: string }) {
  if (field.kind === 'meta') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
        <span className="font-medium">{field.label}</span>
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-700 line-through dark:text-red-400">
          {oldVal || '—'}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400">
          {newVal || '—'}
        </span>
      </div>
    );
  }
  const ops = diffLines(oldVal, newVal);
  const { added, removed } = diffStat(ops);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{field.label}</span>
        <span className="font-mono text-[11px] text-green-600 dark:text-green-400">+{added}</span>
        <span className="font-mono text-[11px] text-red-600 dark:text-red-400">−{removed}</span>
      </div>
      <DiffBlock ops={ops} />
    </div>
  );
}

// ─── Version picker ──────────────────────────────────────────────────────────

function VersionPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value != null ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              v{n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function VersionCompare({
  componentId,
  basePath,
  versionNumbers,
}: {
  componentId: string;
  basePath: string;
  versionNumbers: number[];
}) {
  const sorted = useMemo(() => [...versionNumbers].sort((a, b) => b - a), [versionNumbers]);
  // Default: compare the two most recent (base = older, target = newer).
  const [baseV, setBaseV] = useState<number | null>(sorted[1] ?? null);
  const [targetV, setTargetV] = useState<number | null>(sorted[0] ?? null);
  const [base, setBase] = useState<FullVersion | null>(null);
  const [target, setTarget] = useState<FullVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersion = useCallback(
    async (v: number): Promise<FullVersion> => {
      const res = await fetch(
        `${basePath}/api/handoff/components/history/version?id=${encodeURIComponent(componentId)}&v=${v}`
      );
      if (!res.ok) throw new Error(`v${v}: HTTP ${res.status}`);
      const json = (await res.json()) as { version: FullVersion | null };
      if (!json.version) throw new Error(`v${v} not found`);
      return json.version;
    },
    [basePath, componentId]
  );

  useEffect(() => {
    if (baseV == null || targetV == null || baseV === targetV) {
      setBase(null);
      setTarget(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Always diff old → new regardless of which selector holds which.
    const olderV = Math.min(baseV, targetV);
    const newerV = Math.max(baseV, targetV);
    Promise.all([fetchVersion(olderV), fetchVersion(newerV)])
      .then(([o, n]) => {
        if (cancelled) return;
        setBase(o);
        setTarget(n);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load versions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseV, targetV, fetchVersion]);

  const changedFields = useMemo(() => {
    if (!base || !target) return [];
    return FIELDS.map((f) => {
      const oldVal = f.get(base.snapshot);
      const newVal = f.get(target.snapshot);
      return { field: f, oldVal, newVal, changed: textChanged(oldVal, newVal) };
    }).filter((x) => x.changed);
  }, [base, target]);

  if (sorted.length < 2) {
    return <p className="text-xs text-muted-foreground">Need at least two versions to compare.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/10 px-3 py-2">
        <VersionPicker label="Base" value={baseV} options={sorted} onChange={setBaseV} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <VersionPicker label="Compare" value={targetV} options={sorted} onChange={setTargetV} />
        {base && target && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            v{base.versionNumber} → v{target.versionNumber}
          </span>
        )}
      </div>

      {baseV === targetV && <p className="text-xs text-muted-foreground">Pick two different versions.</p>}
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && !error && base && target && (
        changedFields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No differences in the compared fields between these versions.
          </p>
        ) : (
          <div className="space-y-4">
            {changedFields.map(({ field, oldVal, newVal }) => (
              <FieldDiff key={field.key} field={field} oldVal={oldVal} newVal={newVal} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
