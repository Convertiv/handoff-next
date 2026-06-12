'use client';

import type { ClientConfig } from '@handoff/types/config';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  ImageIcon,
  Loader2Icon,
  Pencil,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Layout from '@/components/Layout/Main';
import { handoffApiUrl } from '@/lib/api-path';
import type { SectionLink } from '@/components/util';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssetWithUsages } from '@/lib/asset-types';

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
  asset: AssetWithUsages;
};

function SizeRow({ label, w, h }: { label: string; w: number | null; h: number | null }) {
  if (!w && !h) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{w ?? '—'} × {h ?? '—'}</span>
    </div>
  );
}

export default function AssetDetailClient({ menu, config, asset }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(handoffApiUrl(`/api/handoff/assets/${asset.id}`), { method: 'DELETE' });
      router.push('/design/assets');
    } catch {
      setDeleting(false);
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(asset.storageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isIcon = asset.assetType === 'icon';
  const isSvg = asset.mimeType === 'image/svg+xml';

  const PAGE_METADATA = {
    title: asset.title,
    metaTitle: asset.title,
    metaDescription: asset.description ?? '',
  };

  return (
    <Layout config={config} menu={menu} current={null} metadata={PAGE_METADATA}>
      <div className="flex flex-col gap-6 p-6">
        {/* Back + title */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/design/assets">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{asset.title}</h1>
              {asset.description && (
                <p className="text-sm text-muted-foreground">{asset.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyUrl}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copied ? 'Copied!' : 'Copy URL'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={asset.storageUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open
              </a>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Preview */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-center rounded-xl border border-border bg-muted/40 p-6">
              {isSvg && asset.svgContent ? (
                <div
                  className="max-h-80 max-w-full"
                  dangerouslySetInnerHTML={{ __html: asset.svgContent }}
                />
              ) : asset.storageUrl ? (
                <img
                  src={asset.thumbnailUrl || asset.storageUrl}
                  alt={asset.altText || asset.title}
                  className="max-h-80 max-w-full rounded object-contain"
                />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded bg-muted">
                  <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Usages */}
            {asset.usages.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold">Component usages</h2>
                <div className="flex flex-col gap-2">
                  {asset.usages.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{u.componentId}</span>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {u.usageType}
                        </Badge>
                        {u.propKey && (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{u.propKey}</code>
                        )}
                      </div>
                      {u.figmaContainerWidth && u.figmaContainerHeight && (
                        <span className="text-xs text-muted-foreground">
                          Figma {u.figmaContainerWidth}×{u.figmaContainerHeight}
                          {u.recommendedWidth && u.recommendedHeight &&
                            ` → ${u.recommendedWidth}×${u.recommendedHeight}`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Metadata panel */}
          <div className="space-y-4">
            {/* Tags */}
            {asset.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {asset.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
            )}

            {/* Details */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="secondary" className="capitalize">{asset.assetType}</Badge>
                </div>
                {asset.mimeType && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">MIME</span>
                    <code className="text-xs">{asset.mimeType}</code>
                  </div>
                )}
                {asset.fileSizeBytes && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">File size</span>
                    <span className="text-xs">{(asset.fileSizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                )}
                <SizeRow label="Dimensions" w={asset.nativeWidth} h={asset.nativeHeight} />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Source</span>
                  <Badge variant="outline" className="capitalize text-xs">{asset.sourceType}</Badge>
                </div>
                {asset.collection && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Collection</span>
                    <span className="text-xs">{asset.collection.name}</span>
                  </div>
                )}
                {asset.iconSet && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Icon set</span>
                    <span className="text-xs">{asset.iconSet.name}</span>
                  </div>
                )}
                {isIcon && asset.iconVariant && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Variant</span>
                    <code className="text-xs">{asset.iconVariant}</code>
                  </div>
                )}
              </div>
            </div>

            {/* Alt text */}
            {asset.altText && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alt text</h3>
                <p className="text-sm">{asset.altText}</p>
              </div>
            )}

            {/* Source URL */}
            {asset.sourceUrl && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</h3>
                <a
                  href={asset.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {asset.sourceUrl}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
