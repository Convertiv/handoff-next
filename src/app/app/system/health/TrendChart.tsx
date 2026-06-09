'use client';
import React from 'react';
import type { ValidationRunRecord } from '@/lib/db/validation-queries';

interface TrendChartProps {
  runs: ValidationRunRecord[];
}

/** Sparkline showing health score over the last N pushes. Pure SVG — no charting lib. */
export function TrendChart({ runs }: TrendChartProps) {
  if (runs.length < 2) return null;

  // Oldest first for left-to-right display
  const ordered = [...runs].reverse();
  const scores = ordered.map((r) => r.score ?? 100);
  const min = Math.max(0, Math.min(...scores) - 5);
  const max = Math.min(100, Math.max(...scores) + 5);
  const W = 280, H = 56, PAD = 4;

  const x = (i: number) => PAD + (i / (scores.length - 1)) * (W - PAD * 2);
  const y = (s: number) => H - PAD - ((s - min) / (max - min || 1)) * (H - PAD * 2);

  const points = scores.map((s, i) => `${x(i)},${y(s)}`).join(' ');
  const area = `M${x(0)},${H} ` + scores.map((s, i) => `L${x(i)},${y(s)}`).join(' ') + ` L${x(scores.length - 1)},${H} Z`;

  const last = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2];
  const delta = last.score != null && prev.score != null ? last.score - prev.score : null;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Score trend ({runs.length} pushes)</span>
        {delta !== null && (
          <span className={delta >= 0 ? 'text-green-600' : 'text-red-500'}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} last push
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 56 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" className="text-sky-500" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-sky-500" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className="text-sky-500"
        />
        {/* latest dot */}
        <circle
          cx={x(scores.length - 1)}
          cy={y(scores[scores.length - 1])}
          r="3"
          fill="currentColor"
          className="text-sky-500"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(ordered[0].runAt)}</span>
        <span>{formatDate(ordered[ordered.length - 1].runAt)}</span>
      </div>
    </div>
  );
}

function formatDate(d: Date | string) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
