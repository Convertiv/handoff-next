'use client';

import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { handoffApiUrl } from '../../../../lib/api-path';

type PublicArtifact = {
  id: string;
  title: string;
  description: string;
  status: string;
  imageUrl: string;
  assets: { label: string; imageUrl: string; prompt?: string }[];
  assetsStatus?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Props = { artifactId: string };

export default function SharePublicClient({ artifactId }: Props) {
  const [artifact, setArtifact] = useState<PublicArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!artifactId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}/public`));
        const json = (await res.json().catch(() => ({}))) as { artifact?: PublicArtifact; error?: string };
        if (!res.ok) throw new Error(json.error || `Not found (${res.status})`);
        if (!json.artifact) throw new Error('Not found.');
        if (!cancelled) setArtifact(json.artifact);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  if (!loaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Design not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error || 'This link may be invalid or sharing was turned off.'}</p>
      </div>
    );
  }

  const assets = Array.isArray(artifact.assets) ? artifact.assets : [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{artifact.title || 'Shared design'}</h1>
        {artifact.description ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{artifact.description}</p> : null}
      </header>

      <div className="overflow-hidden rounded-xl border bg-muted/20">
        {artifact.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artifact.imageUrl} alt={artifact.title || 'Design'} className="mx-auto max-h-[min(85vh,1200px)] w-full object-contain" />
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">No image.</p>
        )}
      </div>

      {assets.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assets</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {assets.map((a, i) => (
              <div key={`${a.label}-${i}`} className="overflow-hidden rounded-lg border bg-card">
                <p className="border-b px-3 py-2 text-xs font-medium">{a.label}</p>
                <div className="bg-muted/30 p-2">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt={a.label} className="mx-auto max-h-64 w-full object-contain" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
