import type { ComponentListObject } from '@handoff/transformers/preview/types';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import { isServerAiConfigured } from '../../lib/server/ai-client';
import { serializeFoundationsFromTokens } from '../../lib/server/design-prompt-builder';
import type { Metadata as DocMetadata } from '../../components/util';
import DesignClient from './DesignClient';
import type {
  DesignWorkbenchComponentPreviewRef,
  DesignWorkbenchComponentRow,
  DesignWorkbenchFoundationContext,
} from './workbench-types';

function summarizeProps(props: unknown): string {
  if (!props || typeof props !== 'object') return '';
  return Object.keys(props as Record<string, unknown>)
    .slice(0, 48)
    .join(', ');
}

function buildPreviewRefs(c: ComponentListObject): DesignWorkbenchComponentPreviewRef[] {
  const previews = c.previews;
  if (!previews || typeof previews !== 'object') return [];
  const out: DesignWorkbenchComponentPreviewRef[] = [];
  for (const [key, raw] of Object.entries(previews)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!url || !/^[\w.-]+\.html$/i.test(url)) continue;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : key;
    out.push({ key, title, url });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function buildComponentRows(list: ComponentListObject[]): DesignWorkbenchComponentRow[] {
  return list.map((c) => ({
    id: c.id,
    title: c.title || c.id,
    group: c.group || '',
    description: (c.description || '').slice(0, 800),
    image: c.image || null,
    propertiesSummary: summarizeProps(c.properties),
    previews: buildPreviewRefs(c),
  }));
}

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'design', '/design');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

type DesignPageProps = {
  searchParams?: Promise<{ loadArtifact?: string | string[] }>;
};

export default async function DesignPage({ searchParams }: DesignPageProps) {
  const sp = searchParams ? await searchParams : {};
  const raw = sp.loadArtifact;
  const loadArtifactId = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? '').trim() : '';

  const { props } = await fetchDocPageMarkdownAsync('docs/', 'design', '/design');
  const config = getClientRuntimeConfig();
  const serverAiAvailable = isServerAiConfigured();

  let components: DesignWorkbenchComponentRow[] = [];
  let foundations: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };

  try {
    const provider = getDataProvider();
    const [list, tokens] = await Promise.all([provider.getComponents(), provider.getTokens()]);
    components = buildComponentRows(list as ComponentListObject[]);
    foundations = serializeFoundationsFromTokens(tokens as unknown);
  } catch {
    components = [];
    foundations = { colors: [], typography: [], effects: [], spacing: [] };
  }

  return (
    <DesignClient
      menu={props.menu}
      metadata={props.metadata as DocMetadata}
      current={props.current}
      config={config}
      serverAiAvailable={serverAiAvailable}
      components={components}
      foundations={foundations}
      loadArtifactId={loadArtifactId || undefined}
    />
  );
}
