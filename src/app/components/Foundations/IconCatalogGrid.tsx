'use client';

import * as React from 'react';
import Link from 'next/link';
import type { IconCatalog, IconCatalogEntry, IconSource } from '../../lib/data/types';
import { Input } from '../ui/input';

function getIconifyUrl(source: IconSource & { type: 'library' }): string {
  const [prefix, name] = source.iconifyId.split(':');
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={copy}
      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition-colors"
      title={`Copy "${text}"`}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function IconTile({ entry }: { entry: IconCatalogEntry }) {
  const { source } = entry;
  const copyValue = source.type === 'library' ? source.iconifyId : entry.name;
  const badge = source.type === 'library' ? source.library : source.type === 'fa-pro' ? 'FA Pro' : 'Custom';

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={`/foundations/icons/${entry.id}`}
        className="flex flex-col items-center gap-4 rounded-lg border border-gray-100/80 bg-gray-100/80 py-8 transition-all hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
        title={entry.usage ?? entry.description ?? entry.name}
      >
        {source.type === 'library' ? (
          <img
            src={getIconifyUrl(source)}
            alt={entry.name}
            className="h-6 w-6"
            loading="lazy"
          />
        ) : (
          <span
            className="h-6 w-6 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: source.svg }}
          />
        )}
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {badge}
        </span>
      </Link>
      <div className="flex items-center justify-between gap-1 px-0.5">
        <p className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-300">{entry.name}</p>
        <CopyButton text={copyValue} />
      </div>
    </div>
  );
}

export default function IconCatalogGrid({ catalog }: { catalog: IconCatalog }) {
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState<string>('all');

  const categories = React.useMemo(() => {
    const cats = Array.from(new Set(catalog.map((e) => e.category))).sort();
    return cats;
  }, [catalog]);

  const filtered = React.useMemo(() => {
    return catalog.filter((entry) => {
      const matchesCat = category === 'all' || entry.category === category;
      if (!matchesCat) return false;
      if (!search) return true;
      const needle = search.toLowerCase();
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.category.toLowerCase().includes(needle) ||
        (entry.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [catalog, search, category]);

  if (catalog.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <h4 className="text-lg font-light text-gray-600 dark:text-gray-300">No icons in catalog.</h4>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Input
        type="text"
        placeholder="Search icons..."
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
        className="px-5 py-6 text-lg"
      />
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['all', ...categories].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                category === cat
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-300">
        <span className="font-medium text-gray-900 dark:text-gray-100">{filtered.length}</span> found
      </p>
      {filtered.length > 0 ? (
        <div className="@container">
          <div className="grid grid-cols-1 gap-5 @sm:grid-cols-2 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
            {filtered.map((entry) => (
              <IconTile key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center">
          <h4 className="text-lg font-light text-gray-600 dark:text-gray-300">No icons found.</h4>
        </div>
      )}
    </div>
  );
}
