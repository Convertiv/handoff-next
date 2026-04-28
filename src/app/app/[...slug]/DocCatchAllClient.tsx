'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRef } from 'react';
import Layout from '../../components/Layout/Main';
import { MarkdownEditor } from '../../components/Markdown/MarkdownEditor';
import { PageTOC } from '../../components/Navigation/AnchorNav';
import { useAuthUi } from '../../components/context/AuthUiContext';
import HeadersType from '../../components/Typography/Headers';

export default function DocCatchAllClient({
  pageSlug,
  content,
  metadata,
  current,
  menu,
  config,
  isEmptyPage = false,
}: {
  pageSlug: string;
  content: string;
  metadata: Record<string, unknown>;
  current: unknown;
  menu: unknown[];
  config: unknown;
  isEmptyPage?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();

  const hasContent = Boolean(String(content ?? '').trim());
  const allowCreateEmpty = authEnabled && isEmptyPage && (status === 'authenticated' || status === 'loading');

  if (!hasContent && !allowCreateEmpty) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-gray-900">
        <div className="flex flex-col items-center">
          <div className="mb-2 text-7xl font-bold text-gray-800 dark:text-white">404</div>
          <h1 className="mb-4 text-2xl font-semibold text-gray-700 dark:text-gray-300">Oops! Page not found.</h1>
          <p className="mb-6 max-w-md text-center text-gray-500 dark:text-gray-400">
            Sorry, the page you are looking for does not exist or has been moved.
            <br />
            Please check the URL or return to the homepage.
          </p>
          <Link
            href="/"
            className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white shadow-md transition-colors duration-200 hover:bg-blue-700"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const title = (metadata?.title as string) || (metadata?.metaTitle as string) || 'Documentation';
  const description = (metadata?.description as string) || (metadata?.metaDescription as string) || '';

  const layoutMetadata =
    isEmptyPage && !hasContent
      ? {
          ...metadata,
          title: 'New page',
          metaTitle: 'New page',
          description: '',
          metaDescription: '',
        }
      : metadata;

  if (!hasContent && status === 'loading' && authEnabled) {
    return (
      <Layout config={config} menu={menu} current={current} metadata={layoutMetadata}>
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">Loading…</div>
      </Layout>
    );
  }

  return (
    <Layout config={config} menu={menu} current={current} metadata={layoutMetadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{title}</HeadersType.H1>
        {description ? <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{description}</p> : null}
      </div>
      <div className="lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <MarkdownEditor
            pageSlug={pageSlug}
            content={content}
            metadata={metadata}
            bodyRef={bodyRef}
            isEmptyPage={isEmptyPage && Boolean(session)}
          />
        </div>
        <PageTOC body={bodyRef} title="On This Page" />
      </div>
    </Layout>
  );
}
