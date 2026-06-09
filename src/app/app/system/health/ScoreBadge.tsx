'use client';
import React from 'react';
import { gradeColor } from './health-types';

interface ScoreBadgeProps {
  score: number;
  grade: string;
  size?: 'sm' | 'lg';
}

export function ScoreBadge({ score, grade, size = 'lg' }: ScoreBadgeProps) {
  const color = gradeColor(grade);
  const r = size === 'lg' ? 40 : 28;
  const stroke = size === 'lg' ? 6 : 4;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);

  return (
    <div className={`flex flex-col items-center gap-1 ${size === 'sm' ? 'w-16' : 'w-28'}`}>
      <div className="relative">
        <svg
          width={size === 'lg' ? 96 : 64}
          height={size === 'lg' ? 96 : 64}
          className="-rotate-90"
        >
          <circle
            cx={size === 'lg' ? 48 : 32}
            cy={size === 'lg' ? 48 : 32}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-muted/30"
          />
          <circle
            cx={size === 'lg' ? 48 : 32}
            cy={size === 'lg' ? 48 : 32}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={color}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <span
          className={`absolute inset-0 flex flex-col items-center justify-center font-bold ${color} ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}
        >
          {grade}
        </span>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{score.toFixed(1)} / 100</span>
    </div>
  );
}
