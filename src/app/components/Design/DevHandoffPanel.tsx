'use client';

import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, PaletteIcon, PuzzleIcon, TypeIcon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * The "Transition to Dev" result surface: what a developer needs to build this design.
 *
 * Ordering is deliberate and reflects the product's core opinion — **reuse first**. What already
 * exists leads, because the cheapest component is the one you don't build. Token adherence and
 * voice compliance follow as the two conformance checks, then the raw editable spec.
 *
 * Every section is independently optional: specs generated before these fields existed simply
 * render fewer sections rather than breaking.
 */

// Types are structurally duplicated from `@/lib/server/design-spec-types` rather than imported —
// that module is `server-only`, so importing it into a client component fails the build.

interface TokenMatchView {
  observed: string;
  usage: string;
  token: string | null;
  reference: string | null;
  matchLevel: 'exact' | 'close' | 'none';
  note?: string;
}

interface VoiceFindingView {
  text: string;
  role: string;
  verdict: 'pass' | 'warn' | 'fail';
  rule: string;
  detail: string;
  suggestion?: string;
}

export interface DevHandoffSpecView {
  overview?: { name?: string; type?: string; designSystemGroup?: string; summary?: string };
  reuse?: {
    candidates?: { componentId: string; title: string; role: string; confidence: number; note: string }[];
    patterns?: { patternId: string; title: string; note: string }[];
    compositionScore?: number;
    recommendation?: string;
  };
  tokens?: {
    colors?: TokenMatchView[];
    typography?: TokenMatchView[];
    spacing?: TokenMatchView[];
    radii?: TokenMatchView[];
    coverage?: number;
    notes?: string;
  };
  voice?: {
    findings?: VoiceFindingView[];
    bannedPhrasesFound?: string[];
    score?: number;
    summary?: string;
  };
}

export interface DevHandoffStatusView {
  stage: 'not_started' | 'extracting_assets' | 'generating_spec' | 'ready' | 'failed';
  running: boolean;
  progress: number;
  label: string;
  error: string | null;
  warning: string | null;
}

const pct = (n: number | undefined): number => Math.round(Math.max(0, Math.min(1, n ?? 0)) * 100);

/** Colour a score band consistently wherever a percentage is shown. */
function scoreTone(value: number): string {
  if (value >= 80) return 'text-emerald-700 dark:text-emerald-400';
  if (value >= 50) return 'text-amber-700 dark:text-amber-400';
  return 'text-destructive';
}

function ScoreRing({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`text-2xl font-semibold tabular-nums ${scoreTone(value)}`}>{value}%</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Stage progress ────────────────────────────────────────────────────────────

const STAGES: { key: DevHandoffStatusView['stage']; label: string }[] = [
  { key: 'extracting_assets', label: 'Extracting assets' },
  { key: 'generating_spec', label: 'Writing specification' },
  { key: 'ready', label: 'Ready for dev' },
];

export function DevHandoffProgress({ status }: { status: DevHandoffStatusView }) {
  if (status.stage === 'not_started') return null;

  if (status.stage === 'failed') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <XCircleIcon className="h-4 w-4" />
          Transition to dev failed
        </div>
        {status.error ? <p className="mt-1 text-sm text-destructive/90">{status.error}</p> : null}
      </div>
    );
  }

  const activeIndex = STAGES.findIndex((s) => s.key === status.stage);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {status.running ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
          )}
          {status.label}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{pct(status.progress)}%</span>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={pct(status.progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Dev handoff progress"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${status.stage === 'ready' ? 'bg-emerald-500' : 'bg-primary'}`}
          style={{ width: `${pct(status.progress)}%` }}
        />
      </div>

      <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {STAGES.map((s, i) => {
          const done = activeIndex > i || status.stage === 'ready';
          const active = activeIndex === i && status.stage !== 'ready';
          return (
            <li
              key={s.key}
              className={`text-xs ${done ? 'text-emerald-700 dark:text-emerald-400' : active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {done ? '✓ ' : ''}
              {s.label}
            </li>
          );
        })}
      </ol>

      {status.warning ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {status.warning}
        </p>
      ) : null}
    </div>
  );
}

// ── Reuse ─────────────────────────────────────────────────────────────────────

function ReuseSection({ reuse, basePath }: { reuse: NonNullable<DevHandoffSpecView['reuse']>; basePath: string }) {
  const candidates = reuse.candidates ?? [];
  const patterns = reuse.patterns ?? [];
  if (!candidates.length && !patterns.length && !reuse.recommendation) return null;
  const score = pct(reuse.compositionScore);

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <PuzzleIcon className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Build from what exists</h3>
        </div>
        <ScoreRing value={score} label="composable" />
      </header>

      {reuse.recommendation ? (
        <p className="mt-2 text-sm text-emerald-900 dark:text-emerald-100">{reuse.recommendation}</p>
      ) : null}

      {patterns.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Patterns that already fit
          </p>
          <ul className="mt-2 space-y-2">
            {patterns.map((p) => (
              <li key={p.patternId} className="rounded-md border border-emerald-200 bg-background/70 p-3 dark:border-emerald-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${basePath}/playground/${encodeURIComponent(p.patternId)}/`}>Open in playground</Link>
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Components to compose from
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {candidates.map((c) => (
              <li key={`${c.componentId}-${c.role}`} className="rounded-md border border-emerald-200 bg-background/70 p-3 dark:border-emerald-900">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {pct(c.confidence)}%
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">Covers: {c.role}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
                {c.componentId ? (
                  <Link
                    href={`${basePath}/system/component/${encodeURIComponent(c.componentId)}/`}
                    className="mt-2 inline-block text-xs text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                  >
                    View component
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ── Tokens ────────────────────────────────────────────────────────────────────

/** True for values we can render as an actual colour chip. */
function isColorValue(v: string): boolean {
  return /^#([0-9a-f]{3,8})$/i.test(v.trim()) || /^(rgb|hsl)a?\(/i.test(v.trim());
}

const MATCH_BADGE: Record<TokenMatchView['matchLevel'], { label: string; className: string }> = {
  exact: { label: 'exact', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  close: { label: 'close', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  none: { label: 'off-system', className: 'bg-destructive/10 text-destructive' },
};

function TokenGroup({ label, rows }: { label: string; rows: TokenMatchView[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r, i) => {
          const badge = MATCH_BADGE[r.matchLevel] ?? MATCH_BADGE.none;
          return (
            <li key={`${r.observed}-${i}`} className="rounded-md border bg-background p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {isColorValue(r.observed) ? (
                  <span
                    className="h-5 w-5 shrink-0 rounded border"
                    style={{ backgroundColor: r.observed }}
                    aria-hidden="true"
                  />
                ) : null}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.observed}</code>
                <span className="text-xs text-muted-foreground">{r.usage}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                {r.token ? (
                  <>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{r.token}</span>
                    {r.reference ? <code className="rounded bg-muted px-1.5 py-0.5">{r.reference}</code> : null}
                  </>
                ) : (
                  <span className="text-destructive">No matching token</span>
                )}
              </div>
              {r.note && r.matchLevel !== 'exact' ? <p className="mt-1 text-xs text-muted-foreground">{r.note}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TokensSection({ tokens }: { tokens: NonNullable<DevHandoffSpecView['tokens']> }) {
  const groups: [string, TokenMatchView[]][] = [
    ['Color', tokens.colors ?? []],
    ['Typography', tokens.typography ?? []],
    ['Spacing', tokens.spacing ?? []],
    ['Radius', tokens.radii ?? []],
  ];
  if (!groups.some(([, rows]) => rows.length)) return null;
  const score = pct(tokens.coverage);

  return (
    <section className="rounded-lg border p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <PaletteIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Design tokens</h3>
        </div>
        <ScoreRing value={score} label="on-system" />
      </header>
      {tokens.notes ? <p className="mt-2 text-sm text-muted-foreground">{tokens.notes}</p> : null}
      {groups.map(([label, rows]) => (
        <TokenGroup key={label} label={label} rows={rows} />
      ))}
    </section>
  );
}

// ── Voice ─────────────────────────────────────────────────────────────────────

const VERDICT_ICON: Record<VoiceFindingView['verdict'], React.ReactNode> = {
  pass: <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />,
  warn: <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-600" />,
  fail: <XCircleIcon className="h-3.5 w-3.5 text-destructive" />,
};

function VoiceSection({ voice }: { voice: NonNullable<DevHandoffSpecView['voice']> }) {
  const findings = voice.findings ?? [];
  const banned = voice.bannedPhrasesFound ?? [];
  if (!findings.length && !banned.length && !voice.summary) return null;
  const score = pct(voice.score);

  return (
    <section className="rounded-lg border p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TypeIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Brand voice</h3>
        </div>
        <ScoreRing value={score} label="on-voice" />
      </header>

      {voice.summary ? <p className="mt-2 text-sm text-muted-foreground">{voice.summary}</p> : null}

      {banned.length > 0 ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Phrases on the avoid list appear in this copy</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {banned.map((p) => (
              <li key={p} className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                “{p}”
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {findings.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {findings.map((f, i) => (
            <li key={`${f.text}-${i}`} className="rounded-md border bg-background p-2.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{VERDICT_ICON[f.verdict]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">“{f.text}”</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">{f.role}</span> · {f.rule} — {f.detail}
                  </p>
                  {f.suggestion ? (
                    <p className="mt-1 text-xs">
                      <span className="text-muted-foreground">Suggested: </span>
                      <span className="font-medium">“{f.suggestion}”</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── Assets ────────────────────────────────────────────────────────────────────

export interface AssetView {
  key?: string;
  label: string;
  imageUrl: string;
  role?: string;
  description?: string;
  /**
   * Present only on assets generated to a spec requirement (asset-first path). Its absence marks a
   * legacy extracted asset, which is why the two render differently.
   */
  generatedFromRequirement?: {
    slot?: string;
    aspect?: string;
    minWidth?: number;
    size?: string;
    focalPoint?: string | null;
  };
}

/**
 * Generated assets, shown with the requirement each one satisfies.
 *
 * Thumbnails alone would undersell what changed. These are no longer crops recovered from a composite
 * — each was generated to a declared requirement at its own aspect and resolution, so the provenance
 * (slot, aspect, generated size, focal point) IS the claim: these are web-ready files, not extracts.
 * A download link makes that concrete.
 */
export function AssetsSection({ assets, basePath }: { assets: AssetView[]; basePath: string }) {
  const shown = assets.filter((a) => a.imageUrl && a.key !== 'annotated_overview');
  if (!shown.length) return null;

  const generated = shown.filter((a) => a.generatedFromRequirement);
  const src = (url: string) => (/^(data:|blob:|https?:|\/\/)/i.test(url) || !url.startsWith('/') ? url : `${basePath}${url}`);

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Assets</h3>
        {generated.length > 0 ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            {generated.length} generated to spec
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {shown.length} asset{shown.length === 1 ? '' : 's'} ready for development.
      </p>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {shown.map((a, i) => {
          const req = a.generatedFromRequirement;
          return (
            <li key={`${a.key ?? a.label}-${i}`} className="overflow-hidden rounded-md border bg-background">
              <div className="flex aspect-video items-center justify-center bg-[repeating-conic-gradient(#f3f4f6_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(a.imageUrl)} alt={a.label} className="max-h-full max-w-full object-contain" loading="lazy" />
              </div>
              <div className="space-y-1 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs font-medium" title={a.label}>
                    {a.label}
                  </p>
                  <a
                    href={src(a.imageUrl)}
                    download
                    className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Download
                  </a>
                </div>
                {req ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      {req.size ? <span className="tabular-nums">{req.size.replace('x', ' × ')}</span> : null}
                      {req.aspect ? <> · {req.aspect}</> : null}
                      {req.focalPoint ? <> · focal {req.focalPoint}</> : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      fills <code className="rounded bg-muted px-1">{req.slot}</code>
                      {req.minWidth ? <> · needs ≥{req.minWidth}px</> : null}
                    </p>
                  </>
                ) : a.role ? (
                  <p className="truncate text-[11px] text-muted-foreground">{a.role}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Revise ────────────────────────────────────────────────────────────────────

interface PatchResultView {
  ok: boolean;
  target?: 'spec' | 'art-direction' | 'unsure';
  reasoning?: string;
  applied?: { sections: string[]; changeSummary: string; version: number | null; diff?: { summary?: string[] } };
  cannotApply?: string;
  rejectedSections?: string[];
  error?: string;
}

const TARGET_LABEL: Record<string, string> = {
  spec: 'Specification change',
  'art-direction': 'Art direction',
  unsure: 'Needs clarification',
};

/**
 * Revise the specification in words.
 *
 * The point of the whole spec-driven loop lives here: a tweak edits the *contract*, not the picture, so
 * "what changed and why" has a durable answer. Three outcomes are all first-class — applied, art
 * direction (the spec can't hold it), and ambiguous (say which you meant) — because a patcher that
 * guesses on the third case silently produces edits nobody asked for.
 *
 * Applying does NOT re-render the image. That's a separate, explicit step, so a copy fix doesn't cost a
 * fresh generation and a fresh set of differences to review.
 */
function ReviseSection({ artifactId, onApplied }: { artifactId: string; onApplied?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PatchResultView | null>(null);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}/revise-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ request: text }),
      });
      const json = (await res.json().catch(() => ({}))) as PatchResultView;
      setResult(json);
      // Only clear the box on a change that landed — otherwise the user needs their words back to reword.
      if (json.applied) {
        setText('');
        onApplied?.();
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'The revision failed.' });
    } finally {
      setBusy(false);
    }
  };

  const applied = result?.applied;
  const changes = applied?.diff?.summary ?? [];

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Revise the specification</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Describe the change in plain language — &ldquo;shorten the headline&rdquo;, &ldquo;add a phone
        field&rdquo;, &ldquo;the CTA should say Book a demo&rdquo;. It edits the spec and records a new
        version, and does not regenerate the image.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void submit();
          }}
          placeholder="What should change?"
          disabled={busy}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? 'Revising' : 'Revise'}
        </Button>
      </div>

      {result ? (
        <div className="mt-3 space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
          {result.error ? (
            <p className="flex items-start gap-1.5 text-destructive">
              <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {result.error}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {applied ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span className="font-medium">{TARGET_LABEL[result.target ?? ''] ?? 'Result'}</span>
                {applied?.version ? <Badge variant="secondary">version {applied.version}</Badge> : null}
              </div>

              {applied ? (
                <>
                  <p className="text-muted-foreground">{applied.changeSummary}</p>
                  {changes.length ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {changes.slice(0, 12).map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                      {changes.length > 12 ? <li>and {changes.length - 12} more</li> : null}
                    </ul>
                  ) : null}
                </>
              ) : (
                <>
                  {result.reasoning ? <p className="text-muted-foreground">{result.reasoning}</p> : null}
                  {result.cannotApply ? <p>{result.cannotApply}</p> : null}
                </>
              )}

              {/* Surfaced rather than dropped: a change the user thinks they made otherwise just doesn't happen. */}
              {result.rejectedSections?.length ? (
                <p className="text-muted-foreground">
                  Not applied: {result.rejectedSections.join(', ')}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DevHandoffPanel({
  spec,
  assets,
  basePath,
  artifactId,
  canRevise,
  onRevised,
  rawMarkdownSlot,
}: {
  spec: DevHandoffSpecView | null;
  assets: AssetView[];
  basePath: string;
  /** Enables the revise box; omit on read-only surfaces such as the share page. */
  artifactId?: string;
  canRevise?: boolean;
  onRevised?: () => void;
  /** The existing editable markdown editor, tucked behind a disclosure. */
  rawMarkdownSlot?: React.ReactNode;
}) {
  const hasStructured = Boolean(spec?.reuse || spec?.tokens || spec?.voice);

  return (
    <div className="space-y-4">
      {spec?.overview?.summary ? (
        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{spec.overview.name ?? 'Component'}</h3>
            {spec.overview.type ? <Badge variant="secondary">{spec.overview.type}</Badge> : null}
            {spec.overview.designSystemGroup ? <Badge variant="outline">{spec.overview.designSystemGroup}</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{spec.overview.summary}</p>
        </section>
      ) : null}

      {spec?.reuse ? <ReuseSection reuse={spec.reuse} basePath={basePath} /> : null}
      <AssetsSection assets={assets} basePath={basePath} />
      {spec?.tokens ? <TokensSection tokens={spec.tokens} /> : null}
      {spec?.voice ? <VoiceSection voice={spec.voice} /> : null}
      {artifactId && canRevise ? <ReviseSection artifactId={artifactId} onApplied={onRevised} /> : null}

      {rawMarkdownSlot ? (
        hasStructured ? (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              Full specification (editable)
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">{rawMarkdownSlot}</CollapsibleContent>
          </Collapsible>
        ) : (
          rawMarkdownSlot
        )
      ) : null}
    </div>
  );
}
