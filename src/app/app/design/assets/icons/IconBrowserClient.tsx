'use client';

import type { ClientConfig } from '@handoff/types/config';
import { Check, Copy, Loader2Icon, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@/components/Layout/Main';
import { handoffApiUrl } from '@/lib/api-path';
import type { SectionLink } from '@/components/util';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AssetListItem, IconSetRow } from '@/lib/asset-types';

const PAGE_METADATA = {
  title: 'Icon browser',
  metaTitle: 'Icon browser',
  metaDescription: 'Browse and copy SVG icons from the design system.',
};

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
};

function IconTile({ icon, onCopy }: { icon: AssetListItem & { svgContent?: string | null }; onCopy: (icon: AssetListItem & { svgContent?: string | null }) => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy(icon);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      title={icon.title}
      className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex h-10 w-10 items-center justify-center">
        {icon.svgContent ? (
          <div
            className="h-8 w-8 text-foreground [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: icon.svgContent }}
          />
        ) : icon.storageUrl ? (
          <img src={icon.storageUrl} alt={icon.title} className="h-8 w-8 object-contain" />
        ) : (
          <div className="h-8 w-8 rounded bg-muted" />
        )}
      </div>
      <span className="max-w-full truncate text-center text-xs text-muted-foreground">{icon.title}</span>
      <div className={cn(
        'absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 opacity-0 transition-opacity',
        copied && 'opacity-100',
        !copied && 'group-hover:opacity-80',
      )}>
        {copied
          ? <Check className="h-5 w-5 text-green-500" />
          : <Copy className="h-4 w-4 text-foreground/60" />
        }
      </div>
    </button>
  );
}

export default function IconBrowserClient({ menu, config }: Props) {
  const [icons, setIcons] = useState<(AssetListItem & { svgContent?: string | null })[] | null>(null);
  const [iconSets, setIconSets] = useState<IconSetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [setId, setSetId] = useState<string>('all');
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchIcons = useCallback(async (q: string, sid: string) => {
    setError(null);
    try {
      const params = new URLSearchParams({ assetType: 'icon' });
      if (q) params.set('search', q);
      if (sid !== 'all') params.set('iconSetId', sid);
      const res = await fetch(handoffApiUrl(`/api/handoff/assets?${params}`));
      if (!res.ok) throw new Error('Failed to load icons');
      setIcons(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading icons');
    }
  }, []);

  useEffect(() => {
    fetch(handoffApiUrl('/api/handoff/assets/icon-sets'))
      .then((r) => r.json())
      .then(setIconSets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => fetchIcons(search, setId), 300);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [search, setId, fetchIcons]);

  function handleCopy(icon: AssetListItem & { svgContent?: string | null }) {
    const content = icon.svgContent || icon.storageUrl || '';
    navigator.clipboard.writeText(content).catch(() => {});
    setLastCopied(icon.id);
    setTimeout(() => setLastCopied((prev) => (prev === icon.id ? null : prev)), 2000);
  }

  const displayed = useMemo(() => icons ?? [], [icons]);

  return (
    <Layout config={config} menu={menu} current={null} metadata={PAGE_METADATA}>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Icon browser</h1>
          <p className="text-sm text-muted-foreground">Click any icon to copy its SVG to clipboard</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search icons…"
              className="pl-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {iconSets.length > 0 && (
            <Select value={setId} onValueChange={setSetId}>
              <SelectTrigger className="w-44 text-sm">
                <SelectValue placeholder="Icon set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {iconSets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <span className="ml-auto text-xs text-muted-foreground">{displayed.length} icons</span>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {lastCopied && (
          <div className="rounded-md bg-green-500/10 px-4 py-2 text-sm text-green-600">
            SVG copied to clipboard
          </div>
        )}

        {icons === null && !error ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-sm text-muted-foreground">No icons found</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
            {displayed.map((icon) => (
              <IconTile key={icon.id} icon={icon} onCopy={handleCopy} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
