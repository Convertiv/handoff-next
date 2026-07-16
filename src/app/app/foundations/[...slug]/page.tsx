import {
  fetchDocPageMarkdownAsync,
  getClientRuntimeConfig,
  getCurrentSection,
} from '../../../components/util';
import { docsRouteToPageSlug, getHandoffPageBySlug, normalizePageMetadata } from '../../../lib/server/doc-pages';
import { getDataProvider } from '../../../lib/data';
import DocCatchAllClient from '../../[...slug]/DocCatchAllClient';

/**
 * Catch-all for user-created pages under /foundations/* that aren't one of the
 * built-in foundation pages (colors, spacing, typography, grid, ...). Those
 * keep their own dedicated page.tsx and always win over this catch-all — Next
 * resolves a static sibling segment before a dynamic one at the same level —
 * so this only ever renders for a /foundations/<slug> that has no matching
 * static directory, mirroring the top-level [...slug] catch-all but scoped
 * (and DB-slugged) under the foundations/ prefix.
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  return [{ slug: ['_placeholder'] }];
}

function resolveFoundationsSlug(slugParts: string[]) {
  const dirParts = ['foundations', ...slugParts.slice(0, -1)];
  const file = slugParts[slugParts.length - 1];
  const docPath = `docs/${dirParts.join('/')}/`;
  const pageSlug = docsRouteToPageSlug(dirParts, file);
  return { docPath, file, pageSlug };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const { docPath, file, pageSlug } = resolveFoundationsSlug(slug);

  const row = await getHandoffPageBySlug(pageSlug);
  if (row) {
    const m = normalizePageMetadata(row.frontmatter);
    return { title: (m.metaTitle as string) ?? 'Documentation', description: (m.metaDescription as string) ?? '' };
  }

  const { props } = await fetchDocPageMarkdownAsync(docPath, file, '/foundations');
  return {
    title: (props.metadata.metaTitle as string) ?? 'Documentation',
    description: (props.metadata.metaDescription as string) ?? '',
  };
}

export default async function FoundationsCatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const { docPath, file, pageSlug } = resolveFoundationsSlug(slug);

  let props = (await fetchDocPageMarkdownAsync(docPath, file, '/foundations')).props;

  const row = await getHandoffPageBySlug(pageSlug);
  if (row) {
    const menu = await getDataProvider().getMenu();
    props = {
      content: row.markdown,
      metadata: normalizePageMetadata(row.frontmatter),
      options: {},
      menu,
      current: getCurrentSection(menu, '/foundations') ?? null,
    };
  }

  const config = getClientRuntimeConfig();
  const isEmptyPage = !String(props.content ?? '').trim();

  return (
    <DocCatchAllClient
      pageSlug={pageSlug}
      content={props.content}
      metadata={props.metadata}
      current={props.current}
      menu={props.menu}
      config={config}
      isEmptyPage={isEmptyPage}
    />
  );
}
