import {
  buildCatchAllStaticPaths,
  fetchDocPageMarkdownAsync,
  getClientRuntimeConfig,
  getCurrentSection,
  MARKDOWN_CATCHALL_RESERVED_FIRST_SEGMENTS,
} from '../../components/util';
import { docsRouteToPageSlug, getHandoffPageBySlug, normalizePageMetadata } from '../../lib/server/doc-pages';
import { getDataProvider } from '../../lib/data';
import { notFound, redirect } from 'next/navigation';
import DocCatchAllClient from './DocCatchAllClient';

/** Allow runtime-only DB pages (always dynamic server). */
export const dynamicParams = true;

export async function generateStaticParams() {
  const paths = buildCatchAllStaticPaths().map((p) => ({ slug: p.params.slug }));
  return paths.length > 0 ? paths : [{ slug: ['_placeholder'] }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const first = slug[0];
  if (first === 'docs' || MARKDOWN_CATCHALL_RESERVED_FIRST_SEGMENTS.has(first)) {
    return { title: 'Documentation', description: '' };
  }

  const dirParts = slug.slice(0, -1);
  const file = slug[slug.length - 1];
  const docPath = dirParts.length > 0 ? `docs/${dirParts.join('/')}/` : 'docs/';
  const pageSlug = docsRouteToPageSlug(dirParts, file);

  {
    const row = await getHandoffPageBySlug(pageSlug);
    if (row) {
      const m = normalizePageMetadata(row.frontmatter);
      return {
        title: (m.metaTitle as string) ?? 'Documentation',
        description: (m.metaDescription as string) ?? '',
      };
    }
  }

  const { props } = await fetchDocPageMarkdownAsync(docPath, file, `/${slug[0]}`);
  return {
    title: (props.metadata.metaTitle as string) ?? 'Documentation',
    description: (props.metadata.metaDescription as string) ?? '',
  };
}

export default async function MarkdownCatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  if (slug[0] === 'docs') {
    const rest = slug.slice(1);
    redirect(rest.length > 0 ? `/${rest.join('/')}` : '/');
  }

  const first = slug[0];
  if (MARKDOWN_CATCHALL_RESERVED_FIRST_SEGMENTS.has(first)) {
    notFound();
  }

  const dirParts = slug.slice(0, -1);
  const file = slug[slug.length - 1];
  const docPath = dirParts.length > 0 ? `docs/${dirParts.join('/')}/` : 'docs/';
  const sectionId = `/${slug[0]}`;
  const pageSlug = docsRouteToPageSlug(dirParts, file);

  let props = (await fetchDocPageMarkdownAsync(docPath, file, sectionId)).props;

  {
    const row = await getHandoffPageBySlug(pageSlug);
    if (row) {
      const menu = await getDataProvider().getMenu();
      props = {
        content: row.markdown,
        metadata: normalizePageMetadata(row.frontmatter),
        options: {},
        menu,
        current: getCurrentSection(menu, sectionId) ?? null,
      };
    }
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
