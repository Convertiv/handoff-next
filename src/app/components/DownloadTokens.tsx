import { Download } from 'lucide-react';
import Link from 'next/link';
import React from 'react';
import { buttonVariants } from './ui/button';

interface DownloadTokensProps {
  componentId: string;
  scss: string;
  css: string;
  styleDictionary?: string | null;
  types?: string | null;
  /** Tailwind 4 @theme block from DTCG pipeline */
  tailwind?: string;
  /** Resolved DTCG JSON from DTCG pipeline */
  dtcg?: string;
}

export const DownloadTokens: React.FC<DownloadTokensProps> = ({ componentId, css, scss, styleDictionary, types, tailwind, dtcg }) => {
  return (
    <div className="mt-3 flex flex-row flex-wrap gap-3">
      <Link
        className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
        href={'data:text/plain;charset=utf-8,' + encodeURIComponent(css)}
        download={`${componentId}.css`}
      >
        CSS Tokens <Download strokeWidth={1.5} />
      </Link>

      <Link
        className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
        href={'data:text/plain;charset=utf-8,' + encodeURIComponent(scss)}
        download={`${componentId}.scss`}
      >
        SASS Tokens <Download strokeWidth={1.5} />
      </Link>

      {tailwind && (
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
          href={'data:text/css;charset=utf-8,' + encodeURIComponent(tailwind)}
          download={`${componentId}.tailwind.css`}
        >
          Tailwind <Download strokeWidth={1.5} />
        </Link>
      )}

      {styleDictionary && (
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
          href={'data:text/plain;charset=utf-8,' + encodeURIComponent(styleDictionary)}
          download={`${componentId}.tokens.json`}
        >
          Style Dictionary <Download strokeWidth={1.5} />
        </Link>
      )}

      {dtcg && (
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
          href={'data:application/json;charset=utf-8,' + encodeURIComponent(dtcg)}
          download={`${componentId}.dtcg.json`}
        >
          DTCG <Download strokeWidth={1.5} />
        </Link>
      )}

      {types && (
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
          href={'data:text/plain;charset=utf-8,' + encodeURIComponent(types)}
          download={`${componentId}.scss`}
        >
          Component Types <Download strokeWidth={1.5} />
        </Link>
      )}
    </div>
  );
};
