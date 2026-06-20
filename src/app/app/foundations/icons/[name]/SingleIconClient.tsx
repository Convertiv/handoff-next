'use client';

import { Types as CoreTypes } from 'handoff-core';
import HtmlReactParser from 'html-react-parser';
import { Code, Download, Share } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import Layout from '../../../../components/Layout/Main';
import HeadersType from '../../../../components/Typography/Headers';
import { buttonVariants } from '../../../../components/ui/button';
import type { IconCatalogEntry, IconSource } from '../../../../lib/data/types';

// ─── Legacy asset icon (old Figma-extracted SVG format) ──────────────────────

const DisplayIcon: React.FC<{ icon: CoreTypes.IAssetObject }> = ({ icon }) => {
  const htmlData = React.useMemo(() => {
    if (typeof window === 'undefined') return icon.data.replace('<svg', '<svg class="o-icon"');
    const el = document.createElement('div');
    el.innerHTML = icon.data;
    const svg = el.querySelector('svg');
    if (!svg) return '';
    svg.classList.add('o-icon');
    return svg.outerHTML;
  }, [icon.data]);
  return <>{HtmlReactParser(htmlData)}</>;
};

// ─── Catalog icon (new IconCatalogEntry format) ───────────────────────────────

function getIconifyUrl(source: IconSource & { type: 'library' }): string {
  const [prefix, name] = source.iconifyId.split(':');
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

function CatalogIconDisplay({ entry }: { entry: IconCatalogEntry }) {
  const { source } = entry;
  if (source.type === 'library') {
    return <img src={getIconifyUrl(source)} alt={entry.name} className="h-full w-full object-contain" loading="lazy" />;
  }
  return (
    <span
      className="flex h-full w-full items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: source.svg }}
    />
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
    >
      {copied ? 'Copied!' : label} <Code strokeWidth={1.5} />
    </button>
  );
}

function CatalogIconDetail({ entry }: { entry: IconCatalogEntry }) {
  const { source } = entry;
  const copyValue = source.type === 'library' ? source.iconifyId : entry.name;
  const badge = source.type === 'library' ? source.library : source.type === 'fa-pro' ? 'FA Pro' : 'Custom';

  return (
    <div>
      <div className="flex flex-row justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <HeadersType.H1 className="font-mono text-xl">{entry.name}</HeadersType.H1>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {badge}
            </span>
          </div>
          <p className="font-mono text-xs text-gray-400">{entry.id}</p>
        </div>
        <div className="flex flex-row flex-wrap items-start gap-3 pt-1">
          <CopyButton value={copyValue} label="Copy ID" />
          {(source.type === 'custom' || source.type === 'fa-pro') && (
            <>
              <CopyButton value={source.svg} label="Copy SVG" />
              <Link
                href={'data:text/plain;charset=utf-8,' + encodeURIComponent(source.svg)}
                download={entry.name + '.svg'}
                className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
              >
                Download SVG <Download strokeWidth={1.5} />
              </Link>
            </>
          )}
        </div>
      </div>

      <hr className="my-8" />

      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
          <div className="dotted-bg flex items-center justify-center py-12 md:min-h-60">
            <div className="h-16 w-16 scale-[2]">
              <CatalogIconDisplay entry={entry} />
            </div>
          </div>
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-1 items-center justify-center rounded-md border border-gray-200 bg-gray-100 p-8 dark:border-gray-700 dark:bg-gray-800">
              <div className="h-10 w-10">
                <CatalogIconDisplay entry={entry} />
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center rounded-md border border-gray-800 bg-gray-900 p-8">
              <div className="h-10 w-10 brightness-0 invert">
                <CatalogIconDisplay entry={entry} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {(entry.description || entry.usage || (entry.tags && entry.tags.length > 0)) && (
        <div className="mt-8 flex flex-col gap-4 rounded-xl border border-gray-100 p-6 dark:border-gray-800">
          {entry.description && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Description</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{entry.description}</p>
            </div>
          )}
          {entry.usage && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Usage</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{entry.usage}</p>
            </div>
          )}
          {entry.tags && entry.tags.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Category</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{entry.category}</p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <Link href="/foundations/icons" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
          ← Back to Icons
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SingleIconClient({ name, menu, metadata, current, config, assets, catalogEntry }) {
  const legacyIcon = assets?.icons?.find((i) => i.icon === name);

  const copySvg = React.useCallback<React.MouseEventHandler>(
    (event) => {
      event.preventDefault();
      if (legacyIcon) navigator.clipboard.writeText(legacyIcon.data);
    },
    [legacyIcon]
  );

  return (
    <Layout config={config} menu={menu ?? []} current={current} metadata={metadata}>
      {catalogEntry ? (
        <CatalogIconDetail entry={catalogEntry} />
      ) : !legacyIcon ? (
        <div>404 Icon Not Found</div>
      ) : (
        <div>
          <div className="flex flex-row justify-between gap-2">
            <HeadersType.H1 className="font-mono text-xl">{legacyIcon.name}</HeadersType.H1>
            <div className="flex flex-row flex-wrap items-center gap-4">
              <small className="font-mono">{legacyIcon.size}b</small>
              <small>/</small>
              <Link className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'} href="#">
                Share Asset <Share strokeWidth={1.5} />
              </Link>
              <Link onClick={copySvg} className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'} href="#">
                Copy SVG <Code strokeWidth={1.5} />
              </Link>
              <Link
                href={'data:text/plain;charset=utf-8,' + encodeURIComponent(legacyIcon.data)}
                download={legacyIcon.name}
                className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
              >
                Download SVG <Download strokeWidth={1.5} />
              </Link>
            </div>
          </div>
          <hr className="my-10" />
          <div className="@container">
            <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
              <div className="dotted-bg flex items-center justify-center py-12 md:min-h-60">
                <div className="scale-[4]">
                  <DisplayIcon icon={legacyIcon} />
                </div>
              </div>
              <div className="flex h-full flex-col gap-4">
                <div className="flex flex-1 items-center justify-center rounded-md border-gray-200 bg-gray-100 p-4">
                  <DisplayIcon icon={legacyIcon} />
                </div>
                <div className="flex flex-1 items-center justify-center rounded-md border-gray-800 bg-gray-900 p-4">
                  <DisplayIcon icon={legacyIcon} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
