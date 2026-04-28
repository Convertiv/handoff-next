import { buildCatchAllStaticPaths, fetchDocPageMarkdown, getClientRuntimeConfig, getCurrentSection, staticBuildMenu } from '../../../components/util';
import DocCatchAllClient from './DocCatchAllClient';

export const dynamicParams = false;

export async function generateStaticParams() {
  const paths = buildCatchAllStaticPaths().map((p) => ({ slug: p.params.slug }));
  return paths.length > 0 ? paths : [{ slug: ['_placeholder'] }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const dirParts = slug.slice(0, -1);
  const file = slug[slug.length - 1];
  const docPath = dirParts.length > 0 ? `docs/${dirParts.join('/')}/` : 'docs/';
  const { props } = fetchDocPageMarkdown(docPath, file, `/${slug[0]}`);
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function DocCatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const dirParts = slug.slice(0, -1);
  const file = slug[slug.length - 1];
  const docPath = dirParts.length > 0 ? `docs/${dirParts.join('/')}/` : 'docs/';
  const sectionId = `/${slug[0]}`;

  const { props } = fetchDocPageMarkdown(docPath, file, sectionId);
  const config = getClientRuntimeConfig();

  return (
    <DocCatchAllClient
      content={props.content}
      metadata={props.metadata}
      current={props.current}
      menu={props.menu}
      config={config}
    />
  );
}
