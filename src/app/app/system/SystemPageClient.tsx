'use client';

import { PreviewObject } from '@handoff/types/preview';
import { ArrowRight, Badge, History, Settings, Webhook } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { APIComponentList } from '../../components/Component/ComponentLists';
import Layout from '../../components/Layout/Main';
import { NewComponentForm } from './NewComponentForm';
import { MarkdownComponents, remarkCodeMeta } from '../../components/Markdown/MarkdownComponents';
import HeadersType from '../../components/Typography/Headers';
import { Button } from '../../components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '../../components/ui/drawer';
import { JsonTreeView } from '../../components/ui/json-tree-view';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

export default function SystemPageClient({ content, menu, metadata, current, config }) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [components, setComponents] = useState<PreviewObject[]>(undefined);
  const fetchComponents = async () => {
    const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
    const url = `${basePath}/api/components`;
    const data = await fetch(url).then((res) => res.json());
    setComponents(data as PreviewObject[]);
  };
  useEffect(() => { void fetchComponents(); }, []);
  if (!components) {
    return (
      <Layout config={config} menu={menu} current={current} metadata={metadata}>
        <p className="text-muted-foreground">Loading…</p>
      </Layout>
    );
  }

  if ((components ?? []).length === 0) {
    return (
      <Layout config={config} menu={menu} current={current} metadata={metadata}>
        <div className="flex items-center justify-center flex-col gap-2 lg:pr-8">
          <div className="mb-2 flex w-full flex-wrap items-center justify-center gap-2">
            <NewComponentForm />
          </div>
          <div className="mb-3 flex items-center justify-center overflow-hidden">
            <Image src={`${process.env.HANDOFF_APP_BASE_PATH ?? ''}/assets/images/components.svg`} alt="Colors" width={327} height={220} />
          </div>
          <h3 className="text-base font-medium">No Components</h3>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">Start by adding samples to your components folder.</p>
          <Button asChild variant="link" className="px-0 text-sm font-medium text-gray-900 hover:no-underline dark:text-gray-100">
            <a href="https://www.handoff.com/docs/" target="_blank" rel="noopener noreferrer">
              View Docs
              <ArrowRight className="inline-block transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
        </div>
      </Layout>
    );
  }

  const apiUrl = (typeof window !== 'undefined' ? window.location.origin : '') + `${process.env.HANDOFF_APP_BASE_PATH ?? ''}/api/components.json`;
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <div className="mt-3 flex flex-row flex-wrap items-start justify-between gap-3">
          <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
          <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" asChild>
                  <Link href="/system/changelog" aria-label="Component changelog">
                    <History strokeWidth={1.5} className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Component changelog</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {isAdmin && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" asChild>
                    <Link href="/admin/reference" aria-label="Reference settings">
                      <Settings strokeWidth={1.5} className="h-4 w-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Reference settings</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Drawer direction="right">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DrawerTrigger asChild>
                    <Button variant="outline">API <Webhook strokeWidth={1.5} /></Button>
                  </DrawerTrigger>
                </TooltipTrigger>
                <TooltipContent side="left"><Badge>{apiUrl}</Badge></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DrawerContent>
              <div className="mx-5 w-full max-w-lg">
                <DrawerHeader>
                  <DrawerTitle>API Response</DrawerTitle>
                  <p className="font-mono text-xs text-gray-500">{apiUrl}</p>
                </DrawerHeader>
                <div className="max-h-[80vh] w-full overflow-auto">
                  <JsonTreeView data={components} />
                </div>
              </div>
            </DrawerContent>
          </Drawer>
          </div>
        </div>
      </div>
      <div>
        <div className="prose mb-10">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
        <APIComponentList components={components} />
      </div>
    </Layout>
  );
}
