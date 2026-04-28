'use client';

import { Types as CoreTypes } from 'handoff-core';
import HtmlReactParser from 'html-react-parser';
import { Code, Download, Share } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import Footer from '../../../../components/Footer';
import Layout from '../../../../components/Layout/Main';
import HeadersType from '../../../../components/Typography/Headers';
import { buttonVariants } from '../../../../components/ui/button';

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

export default function SingleIconClient({ name, menu, metadata, current, config, assets }) {
  const icon = assets?.icons?.find((i) => i.icon === name);

  const copySvg = React.useCallback<React.MouseEventHandler>(
    (event) => {
      event.preventDefault();
      if (icon) navigator.clipboard.writeText(icon.data);
    },
    [icon]
  );

  return (
    <Layout config={config} menu={menu ?? []} current={current} metadata={metadata}>
      {!icon ? (
        <div>404 Icon Not Found</div>
      ) : (
        <div>
          <div className="flex flex-row justify-between gap-2">
            <HeadersType.H1 className="font-mono text-xl">{icon.name}</HeadersType.H1>
            <div className="flex flex-row flex-wrap items-center gap-4">
              <small className="font-mono">{icon.size}b</small>
              <small>/</small>
              <Link className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'} href="#">
                Share Asset <Share strokeWidth={1.5} />
              </Link>
              <Link onClick={copySvg} className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'} href="#">
                Copy SVG <Code strokeWidth={1.5} />
              </Link>
              <Link
                href={'data:text/plain;charset=utf-8,' + encodeURIComponent(icon.data)}
                download={icon.name}
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
                  <DisplayIcon icon={icon} />
                </div>
              </div>
              <div className="flex h-full flex-col gap-4">
                <div className="flex flex-1 items-center justify-center rounded-md border-gray-200 bg-gray-100 p-4">
                  <DisplayIcon icon={icon} />
                </div>
                <div className="flex flex-1 items-center justify-center rounded-md border-gray-800 bg-gray-900 p-4">
                  <DisplayIcon icon={icon} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <Footer config={config} />
    </Layout>
  );
}
