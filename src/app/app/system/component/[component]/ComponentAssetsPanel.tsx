'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { handoffApiUrl } from '../../../../lib/api-path';

type AssetUsageRow = {
  id: number;
  assetId: string;
  usageType: string;
  propKey: string | null;
  notes: string | null;
  asset?: {
    id: string;
    title: string;
    storageUrl: string;
    thumbnailUrl: string | null;
    assetType: string;
  } | null;
};

/**
 * "Assets used by this component" — the reverse of the asset-detail page's
 * "Component usages". Lists library assets linked to this component (e.g. images
 * referenced by the component's preview), each linking to its asset detail page.
 */
export default function ComponentAssetsPanel({ componentId, basePath }: { componentId: string; basePath: string }) {
  const [usages, setUsages] = useState<AssetUsageRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/assets/usages?componentId=${encodeURIComponent(componentId)}`), {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        // The endpoint returns a bare array of usage rows (asset nested).
        const rows = (await res.json().catch(() => [])) as AssetUsageRow[];
        if (!cancelled) setUsages(Array.isArray(rows) ? rows : []);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [componentId]);

  if (!loaded || usages.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">Assets used by this component</h2>
      <div className="flex flex-wrap gap-3">
        {usages.map((u) => {
          const a = u.asset;
          const src = a?.thumbnailUrl || a?.storageUrl;
          return (
            <Link
              key={u.id}
              href={`${basePath}/foundations/assets/${u.assetId}`}
              className="group flex w-40 flex-col rounded-lg border border-border bg-card p-2 transition hover:border-primary"
              title={a?.title || u.assetId}
            >
              {src ? (
                <Image
                  src={src.startsWith('/') ? `${basePath}${src}` : src}
                  alt={a?.title || u.assetId}
                  width={144}
                  height={90}
                  unoptimized
                  className="h-20 w-full rounded-md object-cover"
                />
              ) : (
                <div className="flex h-20 w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                  {a?.assetType || 'asset'}
                </div>
              )}
              <span className="mt-1.5 truncate text-xs font-medium">{a?.title || u.assetId}</span>
              <span className="text-[11px] capitalize text-muted-foreground">{u.usageType.replace('_', ' ')}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
