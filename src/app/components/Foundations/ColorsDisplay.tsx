'use client';

import { Types as CoreTypes } from 'handoff-core';
import groupBy from 'lodash/groupBy';
import startCase from 'lodash/startCase';
import upperFirst from 'lodash/upperFirst';
import { useState } from 'react';
import type { DtcgBrandTokens, DtcgToken } from '../../lib/data/types';
import ColorGrid from './ColorGrid';

function groupToColorObjects(groupKey: string, groupVal: unknown): CoreTypes.IColorObject[] {
  if (!groupVal || typeof groupVal !== 'object') return [];
  const result: CoreTypes.IColorObject[] = [];
  for (const [tokenKey, tokenVal] of Object.entries(groupVal as Record<string, unknown>)) {
    if (!tokenVal || typeof tokenVal !== 'object') continue;
    const token = tokenVal as DtcgToken;
    if (token.$type === 'color' && typeof token.$value === 'string') {
      result.push({
        id: `${groupKey}-${tokenKey}`,
        name: tokenKey,
        machineName: tokenKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        value: token.$value,
        blend: null,
        group: groupKey,
        subgroup: null,
        groups: [groupKey],
        sass: `$color-${groupKey}-${tokenKey}`,
        reference: token.$description ?? '',
      });
    }
  }
  return result;
}

function brandToColorGroups(brands: DtcgBrandTokens, activeBrand: string): Record<string, CoreTypes.IColorObject[]> {
  const objects: CoreTypes.IColorObject[] = [];
  const brandGroup = brands[activeBrand];
  const sharedGroup = brands['shared'];

  if (brandGroup) {
    for (const [gKey, gVal] of Object.entries(brandGroup)) {
      objects.push(...groupToColorObjects(gKey, gVal));
    }
  }
  if (sharedGroup) {
    for (const [gKey, gVal] of Object.entries(sharedGroup)) {
      objects.push(...groupToColorObjects(gKey, gVal));
    }
  }

  return groupBy(objects, 'group');
}

/** A pill-style axis switcher (shared by the brand row and the scheme row). */
function AxisSwitcher({ values, active, onSelect }: { values: string[]; active: string; onSelect: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onSelect(v)}
          className={[
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            active === v
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-muted-foreground hover:bg-muted',
          ].join(' ')}
        >
          {startCase(v)}
        </button>
      ))}
    </div>
  );
}

type Props = {
  brands: DtcgBrandTokens;
  brandNames: string[];
  /**
   * P1.6d: brand × scheme color matrix resolved from a multi-axis source. When
   * present it takes precedence over `brands` and renders a scheme toggle beside
   * the brand switcher — the brand × scheme visualization matrix.
   */
  colorMatrix?: Record<string, Record<string, CoreTypes.IColorObject[]>>;
  schemeNames?: string[];
};

export function ColorsDisplay({ brands, brandNames, colorMatrix, schemeNames }: Props) {
  const [activeBrand, setActiveBrand] = useState(brandNames[0] ?? '');
  const [activeScheme, setActiveScheme] = useState(schemeNames?.[0] ?? '');

  const usingMatrix = !!colorMatrix;
  // Schemes available for the active brand (may vary per brand); fall back to a
  // valid one when the current selection isn't present for this brand.
  const schemesForBrand = usingMatrix ? Object.keys(colorMatrix![activeBrand] ?? {}) : [];
  const effectiveScheme = usingMatrix
    ? (schemesForBrand.includes(activeScheme) ? activeScheme : (schemesForBrand[0] ?? ''))
    : '';

  const colorGroups = usingMatrix
    ? groupBy(colorMatrix![activeBrand]?.[effectiveScheme] ?? [], 'group')
    : brandToColorGroups(brands, activeBrand);

  const schemeOptions = schemeNames ?? [];

  return (
    <>
      {(brandNames.length > 1 || (usingMatrix && schemeOptions.length > 1)) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-3">
          {brandNames.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand</span>
              <AxisSwitcher values={brandNames} active={activeBrand} onSelect={setActiveBrand} />
            </div>
          )}
          {usingMatrix && schemeOptions.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scheme</span>
              <AxisSwitcher values={schemeOptions} active={effectiveScheme} onSelect={setActiveScheme} />
            </div>
          )}
        </div>
      )}
      {Object.keys(colorGroups).map((group) => (
        <ColorGrid
          key={group}
          title={upperFirst(group.replace(/-/g, ' '))}
          group={group}
          description=""
          colors={colorGroups[group]}
        />
      ))}
    </>
  );
}
