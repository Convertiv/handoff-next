'use client';

import {
  ArrowLeft,
  Calendar,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { AssetWithUsages } from '../../../lib/asset-types';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

const BASE = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/50 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}

export default function AssetDetailClient({ id }: { id: string }) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const router = useRouter();

  const [asset, setAsset] = useState<AssetWithUsages | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/handoff/assets/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setAsset(data as AssetWithUsages);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  async function handleCopyUrl() {
    if (!asset) return;
    await navigator.clipboard.writeText(asset.storageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleDelete() {
    if (!asset || !confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`${BASE}/api/handoff/assets/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push(`${BASE}/foundations/assets`);
    } else {
      setDeleting(false);
      alert('Failed to delete asset.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-muted-foreground">Asset not found.</p>
        <Link
          href={`${BASE}/foundations/assets`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Assets
        </Link>
      </div>
    );
  }

  const isImage = asset.mimeType?.startsWith('image/');
  const isVideo = asset.mimeType?.startsWith('video/');
  const isSvg = asset.mimeType === 'image/svg+xml';

  return (
    <div className="flex flex-col gap-6 pb-12">
      <div>
        <Link
          href={`${BASE}/foundations/assets`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Assets
        </Link>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Preview */}
        <div className="flex flex-col gap-3 lg:flex-1">
          <div
            className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-border bg-[length:16px_16px]"
            style={{
              backgroundImage:
                'linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(-45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,hsl(var(--muted)) 75%),linear-gradient(-45deg,transparent 75%,hsl(var(--muted)) 75%)',
              backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
            }}
          >
            {isVideo ? (
              <video
                src={asset.storageUrl}
                className="max-h-96 max-w-full object-contain"
                controls
                preload="metadata"
              />
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.storageUrl}
                alt={asset.altText ?? asset.title}
                className="max-h-96 max-w-full object-contain p-4"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-16">
                <FileImage className="h-12 w-12 text-muted-foreground/40" strokeWidth={1} />
                <span className="text-sm text-muted-foreground">{asset.mimeType ?? 'Unknown type'}</span>
              </div>
            )}
          </div>

          {/* SVG source copy */}
          {isSvg && asset.svgContent && (
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SVG Source</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(asset.svgContent!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied!' : 'Copy SVG'}
                </button>
              </div>
              <pre className="overflow-x-auto text-[11px] text-muted-foreground max-h-32">
                {asset.svgContent.slice(0, 500)}{asset.svgContent.length > 500 ? '…' : ''}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyUrl}>
              <Copy className="mr-2 h-4 w-4" strokeWidth={1.5} />
              {copied ? 'Copied!' : 'Copy URL'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={asset.storageUrl} target="_blank" rel="noopener noreferrer" download>
                <Download className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Download
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={asset.storageUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Open
              </a>
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" disabled>
                  <Pencil className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  )}
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Metadata panel */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0">
          <div className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">{asset.title}</h2>
              {asset.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{asset.description}</p>
              )}
            </div>
            <div className="px-4 py-1">
              <MetaRow
                label="Type"
                value={
                  <Badge variant="secondary" className="text-xs">
                    {asset.assetType}
                  </Badge>
                }
              />
              {asset.nativeWidth && asset.nativeHeight && (
                <MetaRow
                  label="Dimensions"
                  value={`${asset.nativeWidth} × ${asset.nativeHeight} px`}
                />
              )}
              <MetaRow label="File size" value={formatBytes(asset.fileSizeBytes)} />
              <MetaRow label="MIME type" value={asset.mimeType ?? '—'} />
              {asset.collection && (
                <MetaRow label="Collection" value={asset.collection.name} />
              )}
              {asset.iconSet && (
                <MetaRow label="Icon set" value={asset.iconSet.name} />
              )}
              {asset.altText && <MetaRow label="Alt text" value={asset.altText} />}
              <MetaRow label="Added" value={formatDate(asset.createdAt)} />
              <MetaRow
                label="Status"
                value={
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      asset.status === 'active'
                        ? 'border-green-500/40 text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {asset.status}
                  </Badge>
                }
              />
            </div>

            {asset.usages.length > 0 && (
              <div className="border-t border-border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Used in
                </p>
                <div className="flex flex-col gap-1">
                  {asset.usages.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                    >
                      <Link href={`${BASE}/system/component/${u.componentId}`} className="truncate text-primary hover:underline">
                        {u.componentId}
                      </Link>
                      {u.figmaContainerWidth && u.figmaContainerHeight && (
                        <span className="shrink-0 text-[10px]">
                          {u.figmaContainerWidth}×{u.figmaContainerHeight}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tags */}
          {asset.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {asset.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
