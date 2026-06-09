'use client';
import React from 'react';
import type { ValidatorBreakdownEntry } from '@/lib/db/validation-queries';

interface ValidatorBreakdownBarsProps {
  breakdown: ValidatorBreakdownEntry[];
}

export function ValidatorBreakdownBars({ breakdown }: ValidatorBreakdownBarsProps) {
  if (breakdown.length === 0) return null;
  return (
    <div className="space-y-2">
      {breakdown.map((v) => {
        const total = v.passed + v.failed + v.skipped;
        const passedPct = total > 0 ? (v.passed / total) * 100 : 0;
        const failedPct = total > 0 ? (v.failed / total) * 100 : 0;
        return (
          <div key={v.id} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{v.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {v.passed}✓ {v.failed > 0 && <span className="text-red-500">{v.failed}✗</span>}
                {v.skipped > 0 && <span className="text-slate-400 ml-1">{v.skipped}–</span>}
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="bg-red-500 transition-all" style={{ width: `${failedPct}%` }} />
              <div className="bg-green-500 transition-all" style={{ width: `${passedPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
