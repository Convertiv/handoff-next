'use client';

import React, { useState } from 'react';
import startCase from 'lodash/startCase';
import { Check, Copy } from 'lucide-react';
import { DtcgBrandTokens, DtcgToken } from '../../lib/data/types';

type Swatch = { name: string; value: string; cssVar: string };
type SwatchGroup = { label: string; swatches: Swatch[] };

/** Walk a DTCG token group and collect color swatches. */
function collectSwatches(group: Record<string, unknown>): Swatch[] {
  const swatches: Swatch[] = [];
  for (const [key, val] of Object.entries(group)) {
    if (val && typeof val === 'object') {
      const node = val as DtcgToken;
      if (node.$type === 'color' && typeof node.$value === 'string') {
        swatches.push({ name: key, value: node.$value, cssVar: node.$description ?? '' });
      }
    }
  }
  return swatches;
}

/** Split a brand's token tree into labeled swatch groups (ramp + semantic + shared gray). */
function groupsForBrand(brandTokens: Record<string, unknown>, sharedTokens?: Record<string, unknown>): SwatchGroup[] {
  const groups: SwatchGroup[] = [];

  for (const [groupKey, groupVal] of Object.entries(brandTokens)) {
    if (groupKey === 'layout' || groupKey === 'semantic') continue;
    if (!groupVal || typeof groupVal !== 'object') continue;
    const swatches = collectSwatches(groupVal as Record<string, unknown>);
    if (swatches.length > 0) {
      groups.push({ label: startCase(groupKey.replace(/-/g, ' ')), swatches });
    }
  }

  const semantic = brandTokens['semantic'];
  if (semantic && typeof semantic === 'object') {
    const swatches = collectSwatches(semantic as Record<string, unknown>);
    if (swatches.length > 0) groups.push({ label: 'Semantic', swatches });
  }

  if (sharedTokens) {
    for (const [groupKey, groupVal] of Object.entries(sharedTokens)) {
      if (!groupVal || typeof groupVal !== 'object') continue;
      const swatches = collectSwatches(groupVal as Record<string, unknown>);
      if (swatches.length > 0) groups.push({ label: startCase(groupKey), swatches });
    }
  }

  return groups;
}

const SwatchCell: React.FC<{ swatch: Swatch }> = ({ swatch }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(swatch.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title={`${swatch.name} — ${swatch.value}`}
      className="group flex flex-col items-start gap-1 text-left"
    >
      <div
        className="relative h-12 w-full rounded-md border border-black/5"
        style={{ background: swatch.value }}
      >
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          {copied
            ? <Check className="size-3.5 drop-shadow-sm" style={{ color: contrastColor(swatch.value) }} />
            : <Copy className="size-3.5 drop-shadow-sm" style={{ color: contrastColor(swatch.value) }} />}
        </span>
      </div>
      <p className="w-full truncate text-[11px] font-medium leading-tight">{swatch.name}</p>
      <p className="w-full truncate font-mono text-[10px] text-muted-foreground">{swatch.value}</p>
    </button>
  );
};

/** Naive luminance check for icon contrast on a hex background. */
function contrastColor(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#000';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? '#000' : '#fff';
}

type Props = {
  brands: DtcgBrandTokens;
  brandNames: string[];
};

const BrandColorSwatches: React.FC<Props> = ({ brands, brandNames }) => {
  const [activeBrand, setActiveBrand] = useState(brandNames[0] ?? '');

  const brandTokens = brands[activeBrand];
  const sharedTokens = brands['shared'];
  if (!brandTokens) return null;

  const groups = groupsForBrand(
    brandTokens as Record<string, unknown>,
    sharedTokens as Record<string, unknown> | undefined
  );

  return (
    <div className="mb-10">
      {brandNames.length > 1 && (
        <div className="mb-6 flex gap-2 border-b pb-3">
          {brandNames.map((b) => (
            <button
              key={b}
              onClick={() => setActiveBrand(b)}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeBrand === b
                  ? 'bg-slate-900 text-white'
                  : 'text-muted-foreground hover:bg-muted',
              ].join(' ')}
            >
              {startCase(b)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.label}>
            <h4 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {group.label}
            </h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-3">
              {group.swatches.map((s) => (
                <SwatchCell key={s.name} swatch={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrandColorSwatches;
