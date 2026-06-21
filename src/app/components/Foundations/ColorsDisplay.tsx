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

type Props = {
  brands: DtcgBrandTokens;
  brandNames: string[];
};

export function ColorsDisplay({ brands, brandNames }: Props) {
  const [activeBrand, setActiveBrand] = useState(brandNames[0] ?? '');
  const colorGroups = brandToColorGroups(brands, activeBrand);

  return (
    <>
      {brandNames.length > 1 && (
        <div className="mb-6 flex gap-2 border-b pb-3">
          {brandNames.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setActiveBrand(b)}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeBrand === b
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-muted-foreground hover:bg-muted',
              ].join(' ')}
            >
              {startCase(b)}
            </button>
          ))}
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
