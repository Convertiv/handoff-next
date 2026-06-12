'use client';

import type { ClientConfig } from '@handoff/types/config';
import {
  FolderOpen,
  ImageIcon,
  LayoutGrid,
  Loader2Icon,
  Rows,
  Search,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@/components/Layout/Main';
import { handoffApiUrl } from '@/lib/api-path';
import type { SectionLink } from '@/components/util';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssetListItem, CollectionRow } from '@/lib/asset-types';

const PAGE_METADATA = {
  title: 'Asset library',
  metaTitle: 'Asset library',
  metaDescription: 'Browse and manage design system assets — logos, icons, and images.',
};

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
};

type ViewMode = 'grid' | 'list';
type AssetTypeFilter = 'all' | 'logo' | 'icon' | 'image' | 'video';

function AssetCard({ asset }: { asset: AssetListItem }) {
  const thumb = asset.thumbnailUrl || asset.storageUrl;
  return (
    <Link
      href={`/design/assets/${asset.id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:shadow-md"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {thumb ? (
          <img src={thumb} alt={asset.title ?? ''} className="h-full w-full object-cover object-center" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="text-xs capitalize">
            {asset.assetType}
          </Badge>
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{asset.title}</p>
        {asset.collectionName && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{asset.collectionName}</p>
        )}
        {asset.nativeWidth && asset.nativeHeight && (
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            {asset.nativeWidth} × {asset.nativeHeight}
          </p>
        )}
      </div>
    </Link>
  );
}

function AssetRow({ asset }: { asset: AssetListItem }) {
  const thumb = asset.thumbnailUrl || asset.storageUrl;
  return (
    <Link
      href={`/design/assets/${asset.id}`}
      className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:shadow-md"
    >
      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
        {thumb ? (
          <img src={thumb} alt={asset.title ?? ''} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[asset.collectionName, asset.mimeType].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {asset.nativeWidth && asset.nativeHeight && (
          <span className="text-xs text-muted-foreground/60">
            {asset.nativeWidth}×{asset.nativeHeight}
          </span>
        )}
        <Badge variant="secondary" className="text-xs capitalize">
          {asset.assetType}
        </Badge>
      </div>
    </Link>
  );
}

export default function AssetsClient({ menu, config }: Props) {
  const [assets, setAssets] = useState<AssetListItem[] | null>(null);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [assetType, setAssetType] = useState<AssetTypeFilter>('all');
  const [collectionId, setCollectionId] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAssets = useCallback(
    async (q: string, type: AssetTypeFilter, cid: string) => {
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q) params.set('search', q);
        if (type !== 'all') params.set('assetType', type);
        if (cid !== 'all') params.set('collectionId', cid);
        const res = await fetch(handoffApiUrl(`/api/handoff/assets?${params}`));
        if (!res.ok) throw new Error('Failed to load assets');
        setAssets(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error loading assets');
      }
    },
    []
  );

  useEffect(() => {
    fetch(handoffApiUrl('/api/handoff/assets/collections'))
      .then((r) => r.json())
      .then(setCollections)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => fetchAssets(search, assetType, collectionId), 300);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [search, assetType, collectionId, fetchAssets]);

  const displayed = useMemo(() => assets ?? [], [assets]);

  return (
    <Layout
      config={config}
      menu={menu}
      current={null}
      metadata={PAGE_METADATA}
    >
      <div className="flex h-full flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Asset library</h1>
            <p className="text-sm text-muted-foreground">Logos, icons, and images for the design system</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/design/assets/icons">
                <FolderOpen className="mr-1.5 h-4 w-4" />
                Icon browser
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/design/assets/upload">
                <Upload className="mr-1.5 h-4 w-4" />
                Upload
              </Link>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search assets…"
              className="pl-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetTypeFilter)}>
            <SelectTrigger className="w-36 text-sm">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="logo">Logo</SelectItem>
              <SelectItem value="icon">Icon</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
            </SelectContent>
          </Select>

          {collections.length > 0 && (
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger className="w-44 text-sm">
                <SelectValue placeholder="Collection" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All collections</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as ViewMode)}
            className="ml-auto"
          >
            <ToggleGroupItem value="grid" size="sm"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="list" size="sm"><Rows className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Content */}
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {assets === null && !error ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No assets found</p>
            {search && (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                Clear search
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {displayed.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {displayed.map((a) => (
              <AssetRow key={a.id} asset={a} />
            ))}
          </div>
        )}

        {displayed.length > 0 && (
          <p className={cn('mt-auto text-xs text-muted-foreground')}>
            {displayed.length} asset{displayed.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </Layout>
  );
}
