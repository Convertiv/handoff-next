import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import PlaygroundClient from './PlaygroundClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams?: Promise<{ pattern?: string; kind?: string }>;
}) {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  const config = getClientRuntimeConfig();
  const sp = searchParams ? await searchParams : undefined;
  const initialPatternId = typeof sp?.pattern === 'string' && sp.pattern.length > 0 ? sp.pattern : undefined;
  /**
   * `?kind=template` — "New → Template", a template built from scratch rather than promoted from a page
   * (Brad, 2026-08-13).
   *
   * Carried as intent rather than as a record: nothing exists yet, and the playground creates the row on the
   * first block. This is what that creation reads, so the record is born a template instead of being made one
   * by a second call that could fail.
   */
  const newRecordKind = sp?.kind === 'template' ? 'template' : undefined;
  return (
    <PlaygroundClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      initialPatternId={initialPatternId}
      newRecordKind={newRecordKind}
    />
  );
}
