'use client';

import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface TokenOutputTabsProps {
  css: string;
  scss: string;
  tailwind: string;
  dtcg: string;
  /** base filename for downloads, e.g. "colors" */
  name: string;
}

export function TokenOutputTabs({ css, scss, tailwind, dtcg, name }: TokenOutputTabsProps) {
  const tabs = [
    { id: 'css',      label: 'CSS',      content: css,      filename: `${name}.css`,         mime: 'text/css' },
    { id: 'scss',     label: 'SCSS',     content: scss,     filename: `${name}.scss`,        mime: 'text/plain' },
    { id: 'tailwind', label: 'Tailwind', content: tailwind, filename: `${name}.tailwind.css`, mime: 'text/css' },
    { id: 'dtcg',     label: 'DTCG',     content: dtcg,     filename: `${name}.tokens.json`, mime: 'application/json' },
  ];

  return (
    <div className="mt-6 rounded-lg border bg-muted/30">
      <Tabs defaultValue="css">
        <div className="flex items-center justify-between border-b px-4">
          <TabsList className="h-10 gap-1 bg-transparent p-0">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="rounded-none border-b-2 border-transparent px-3 py-2.5 text-xs font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="mt-0 p-0">
            <CodeBlock content={t.content} filename={t.filename} mime={t.mime} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CodeBlock({ content, filename, mime }: { content: string; filename: string; mime: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const downloadHref = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <a
          href={downloadHref}
          download={filename}
          className="flex h-7 w-7 items-center justify-center rounded border bg-background text-muted-foreground opacity-70 hover:opacity-100"
          title={`Download ${filename}`}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-7 w-7 items-center justify-center rounded border bg-background text-muted-foreground opacity-70 hover:opacity-100"
          title="Copy to clipboard"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-b-lg p-4 pr-20 font-mono text-xs leading-5 text-foreground">
        <code>{content}</code>
      </pre>
    </div>
  );
}
