'use client';

import { ImageIcon, Search, Upload, X, FolderOpen, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { AssetListItem, AssetType, CollectionRow } from '../../lib/asset-types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import HeadersType from '../../components/Typography/Headers';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

const BASE = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

const TYPE_LABELS: Record<AssetType, string> = {
  logo: 'Logo',
  icon: 'Icon',
  image: 'Image',
  video: 'Video',
};

const TYPE_FILTERS: Array<{ value: AssetType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'logo', label: 'Logos' },
  { value: 'icon', label: 'Icons' },
  { value: 'video', label: 'Video' },
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetCard({ asset }: { asset: AssetListItem }) {
  const preview = asset.thumbnailUrl ?? asset.storageUrl;
  const isImage = asset.mimeType?.startsWith('image/');
  const isVideo = asset.mimeType?.startsWith('video/');
  const isSvg = asset.mimeType === 'image/svg+xml';

  return (
    <Link href={`${BASE}/foundations/assets/${asset.id}`} className="group block">
      <div className="overflow-hidden rounded-lg border border-border bg-card transition-all duration-150 hover:border-border/80 hover:shadow-sm">
        <div
          className="relative flex h-40 items-center justify-center overflow-hidden bg-[length:12px_12px]"
          style={{
            backgroundImage:
              'linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(-45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,hsl(var(--muted)) 75%),linear-gradient(-45deg,transparent 75%,hsl(var(--muted)) 75%)',
            backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
          }}
        >
          {isVideo ? (
            <video
              src={preview}
              className="max-h-full max-w-full object-contain"
              muted
              preload="metadata"
            />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt={asset.title}
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <ImageIcon className="h-10 w-10 text-muted-foreground/40" strokeWidth={1} />
          )}
          <div className="absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/5" />
        </div>
        <div className="px-3 py-2.5">
          <p className="truncate text-sm font-medium leading-tight">{asset.title}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="secondary" className="h-4 rounded px-1.5 text-[10px] font-normal">
              {TYPE_LABELS[asset.assetType] ?? asset.assetType}
            </Badge>
            {asset.nativeWidth && asset.nativeHeight && (
              <span className="text-[11px] text-muted-foreground">
                {asset.nativeWidth}×{asset.nativeHeight}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

type UploadState = 'idle' | 'picking' | 'uploading' | 'done' | 'error';

function UploadDialog({
  open,
  onClose,
  collections,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  collections: CollectionRow[];
  onUploaded: (asset: AssetListItem) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('image');
  const [collectionId, setCollectionId] = useState<string>('none');
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState('');

  function reset() {
    setFile(null);
    setTitle('');
    setAssetType('image');
    setCollectionId('none');
    setState('idle');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    if (f.type.startsWith('video/')) setAssetType('video');
    else if (f.type === 'image/svg+xml') setAssetType('icon');
    else if (f.type.startsWith('image/')) setAssetType('image');
  }

  async function handleUpload() {
    if (!file || !title) return;
    setState('uploading');
    setError('');
    try {
      const presignRes = await fetch(`${BASE}/api/handoff/assets/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      if (!presignRes.ok) {
        const j = await presignRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Presign failed');
      }
      const { assetId, uploadUrl, storageKey, publicUrl } = (await presignRes.json()) as {
        assetId: string;
        uploadUrl: string;
        storageKey: string;
        publicUrl: string;
      };

      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      const confirmRes = await fetch(`${BASE}/api/handoff/assets/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          storageKey,
          publicUrl,
          title,
          assetType,
          mimeType: file.type,
          fileSizeBytes: file.size,
          collectionId: collectionId === 'none' ? undefined : collectionId,
          sourceType: 'upload',
        }),
      });
      if (!confirmRes.ok) throw new Error('Confirm failed');
      const asset = (await confirmRes.json()) as AssetListItem;
      setState('done');
      onUploaded(asset);
      handleClose();
    } catch (e) {
      setError((e as Error).message ?? 'Upload failed');
      setState('error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Asset</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div
            className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
            onClick={() => fileRef.current?.click()}
          >
            {file ? (
              <>
                <ImageIcon className="h-6 w-6" strokeWidth={1.5} />
                <span className="text-sm font-medium text-foreground">{file.name}</span>
                <span className="text-xs">{formatBytes(file.size)}</span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6" strokeWidth={1.5} />
                <span className="text-sm">Click to select a file</span>
                <span className="text-xs">PNG, JPG, SVG, WebP, MP4</span>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/webm"
            className="hidden"
            onChange={onFileChange}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Asset title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Image</SelectItem>
                  <SelectItem value="logo">Logo</SelectItem>
                  <SelectItem value="icon">Icon</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {collections.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Collection</label>
                <Select value={collectionId} onValueChange={setCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || !title || state === 'uploading'}
            >
              {state === 'uploading' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AssetsClient() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: 'active' });
      if (typeFilter !== 'all') params.set('assetType', typeFilter);
      if (collectionFilter) params.set('collectionId', collectionFilter);
      if (search) params.set('search', search);
      const [assetsRes, collectionsRes] = await Promise.all([
        fetch(`${BASE}/api/handoff/assets?${params}`),
        fetch(`${BASE}/api/handoff/assets/collections`),
      ]);
      if (assetsRes.ok) setAssets((await assetsRes.json()) as AssetListItem[]);
      if (collectionsRes.ok) setCollections((await collectionsRes.json()) as CollectionRow[]);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, collectionFilter]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  function handleUploaded(asset: AssetListItem) {
    setAssets((prev) => [asset, ...prev]);
  }

  return (
    <>
      <div className="flex flex-col gap-6 pb-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <HeadersType.H1>Assets</HeadersType.H1>
            <p className="mt-1 text-base text-muted-foreground">
              Browse and manage design assets for your system.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setUploadOpen(true)} className="shrink-0">
              <Upload className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Upload
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="pl-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  typeFilter === f.value
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-6">
          {collections.length > 0 && (
            <aside className="hidden w-48 shrink-0 lg:block">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Collections
              </p>
              <nav className="flex flex-col gap-0.5">
                <button
                  onClick={() => setCollectionFilter(null)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
                    !collectionFilter
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  All Assets
                </button>
                {collections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCollectionFilter(c.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
                      collectionFilter === c.id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    )}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    {c.name}
                  </button>
                ))}
              </nav>
            </aside>
          )}

          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <ImageIcon className="h-10 w-10 text-muted-foreground/40" strokeWidth={1} />
                <div>
                  <p className="text-sm font-medium">No assets found</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {search || typeFilter !== 'all' || collectionFilter
                      ? 'Try clearing your filters.'
                      : isAdmin
                        ? 'Upload your first asset to get started.'
                        : 'No assets have been added yet.'}
                  </p>
                </div>
                {isAdmin && !search && typeFilter === 'all' && !collectionFilter && (
                  <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" strokeWidth={1.5} />
                    Upload Asset
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {assets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        collections={collections}
        onUploaded={handleUploaded}
      />
    </>
  );
}
