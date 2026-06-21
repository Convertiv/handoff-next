import type { DtcgManifest } from '../util/dtcg';

interface ProvenanceBadgeProps {
  manifest: DtcgManifest;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function sourceLabel(source: string): string {
  if (source.startsWith('figma:')) return 'Figma';
  return source;
}

export function ProvenanceBadge({ manifest }: ProvenanceBadgeProps) {
  const source = (manifest.sources ?? [])[0] ?? 'unknown';
  const label  = sourceLabel(source);
  const synced = manifest.generatedAt ? timeAgo(manifest.generatedAt) : 'unknown';

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
        in-sync
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>Source: {label}</span>
      <span className="text-muted-foreground/40">·</span>
      <span>Last synced {synced}</span>
    </div>
  );
}
