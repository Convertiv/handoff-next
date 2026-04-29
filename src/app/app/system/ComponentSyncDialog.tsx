'use client';

import { handoffApiUrl } from '@/lib/api-path';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Badge } from '../../components/ui/badge';
import { useCallback, useEffect, useMemo, useState } from 'react';

type IngestDecision = 'skip' | 'filesystem' | 'keep_db';

type ComponentDiff = {
  id: string;
  status: 'new' | 'modified' | 'unchanged' | 'db_only';
  fields: { field: string; filesystem: string | null; database: string | null }[];
  dbSource?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
};

function statusBadge(status: ComponentDiff['status']) {
  switch (status) {
    case 'new':
      return <Badge className="bg-emerald-600">New</Badge>;
    case 'modified':
      return <Badge className="bg-amber-600">Modified</Badge>;
    case 'unchanged':
      return <Badge variant="secondary">Unchanged</Badge>;
    case 'db_only':
      return <Badge variant="outline">DB only</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function sourceBadge(source: string | null | undefined) {
  if (source == null || source === '') return null;
  return (
    <Badge variant="outline" className="font-mono text-[10px]">
      DB: {source}
    </Badge>
  );
}

export function ComponentSyncDialog({ open, onOpenChange, onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<ComponentDiff[]>([]);
  const [decisions, setDecisions] = useState<Record<string, IngestDecision>>({});

  const counts = useMemo(() => {
    const c = { new: 0, modified: 0, unchanged: 0, db_only: 0 };
    for (const d of diffs) {
      if (d.status in c) c[d.status as keyof typeof c] += 1;
    }
    return c;
  }, [diffs]);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/diff'), { credentials: 'include' });
      const data = (await res.json()) as { diffs?: ComponentDiff[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load diff');
      const list = data.diffs ?? [];
      setDiffs(list);
      const init: Record<string, IngestDecision> = {};
      for (const d of list) {
        if (d.status === 'unchanged') init[d.id] = 'skip';
        else if (d.status === 'modified') init[d.id] = 'filesystem';
        else if (d.status === 'new') init[d.id] = 'filesystem';
      }
      setDecisions(init);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadDiff();
  }, [open, loadDiff]);

  const runIngest = async (overwriteAll: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/ingest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(overwriteAll ? { overwriteAll: true } : { decisions }),
      });
      const data = (await res.json()) as { error?: string; ingested?: string[]; hint?: string };
      if (!res.ok) throw new Error(data.error ?? data.hint ?? 'Ingest failed');
      onOpenChange(false);
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  const hasSyncable = counts.new > 0 || counts.modified > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import components from code</DialogTitle>
          <DialogDescription>
            Compares <code className="text-xs">handoff.config.js</code> component directories with the database. Choose how to
            resolve each modified component, then import.
          </DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">Loading diff…</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {!loading && diffs.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{counts.new}</span> new ·{' '}
              <span className="font-medium text-foreground">{counts.modified}</span> modified ·{' '}
              <span className="font-medium text-foreground">{counts.unchanged}</span> unchanged ·{' '}
              <span className="font-medium text-foreground">{counts.db_only}</span> DB only
            </p>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {diffs.map((d) => (
                <div key={d.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{d.id}</span>
                    {statusBadge(d.status)}
                    {sourceBadge(d.dbSource)}
                  </div>
                  {d.status === 'modified' ? (
                    <div className="mt-2 space-y-2">
                      <Label className="text-xs text-muted-foreground">Resolution</Label>
                      <RadioGroup
                        value={decisions[d.id] ?? 'filesystem'}
                        onValueChange={(v) => setDecisions((prev) => ({ ...prev, [d.id]: v as IngestDecision }))}
                        className="flex flex-wrap gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="filesystem" id={`${d.id}-fs`} />
                          <Label htmlFor={`${d.id}-fs`} className="font-normal">
                            Use filesystem
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="keep_db" id={`${d.id}-db`} />
                          <Label htmlFor={`${d.id}-db`} className="font-normal">
                            Keep database
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="skip" id={`${d.id}-skip`} />
                          <Label htmlFor={`${d.id}-skip`} className="font-normal">
                            Skip
                          </Label>
                        </div>
                      </RadioGroup>
                      {d.fields.slice(0, 3).map((f) => (
                        <details key={f.field} className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">{f.field}</summary>
                          <div className="mt-1 grid gap-1 md:grid-cols-2">
                            <pre className="max-h-24 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap break-all">{f.filesystem ?? '—'}</pre>
                            <pre className="max-h-24 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap break-all">{f.database ?? '—'}</pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {d.status === 'new' ? <p className="text-xs text-muted-foreground">Will be inserted from disk.</p> : null}
                  {d.status === 'unchanged' ? <p className="text-xs text-muted-foreground">Skipped by default.</p> : null}
                  {d.status === 'db_only' ? <p className="text-xs text-muted-foreground">Not on disk under configured roots.</p> : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadDiff()} disabled={loading}>
            Refresh diff
          </Button>
          <div className="flex flex-wrap gap-2">
            {hasSyncable ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  if (!confirm('Import all new components from disk and overwrite every modified component from filesystem?')) return;
                  void runIngest(true);
                }}
              >
                Sync all from code
              </Button>
            ) : null}
            <Button type="button" disabled={submitting || loading} onClick={() => void runIngest(false)}>
              {submitting ? 'Importing…' : 'Import with choices'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ComponentExportButton({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    if (!confirm('Export all database components to the components/ folder and create a git commit?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ autoCommit: true }),
      });
      const data = (await res.json()) as { error?: string; exported?: string[]; commitSha?: string; gitWarning?: string };
      if (!res.ok) throw new Error(data.error ?? 'Export failed');
      setMsg(
        `Exported ${data.exported?.length ?? 0} component(s).${data.commitSha ? ` Commit: ${data.commitSha.slice(0, 7)}` : ''}${data.gitWarning ? ` ${data.gitWarning}` : ''}`
      );
      onDone?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Exporting…' : 'Export all to code'}
      </Button>
      {msg ? <span className="max-w-xs text-right text-xs text-muted-foreground">{msg}</span> : null}
    </div>
  );
}
