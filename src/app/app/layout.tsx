import Script from 'next/script';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '../components/util';
import { auth } from '../lib/auth';
import { getDataProvider } from '../lib/data';
import { usePostgres } from '../lib/db/dialect';
import { getHandoffCapabilities, probeRemoteHandoffReachable } from '../lib/handoff-capabilities';
import Providers from './providers';
import '../css/index.css';
import '../css/theme.css';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getClientRuntimeConfig();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const authEnabled = usePostgres();

  // First-run check: registry mode with no users → send to /setup.
  // Uses x-pathname header injected by middleware (no extra DB query on every request
  // once users exist — early-exit on the no-DB or non-zero-user paths).
  if (authEnabled) {
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? '/';
    if (!pathname.startsWith('/setup') && !pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
      try {
        const { getUserCount } = await import('../lib/db/queries');
        const userCount = await getUserCount();
        if (userCount === 0) redirect('/setup');
      } catch {
        // DB unreachable — don't block; request errors will surface naturally
      }
    }
  }

  const menu = await getDataProvider().getMenu();
  const session = await auth().catch(() => null);
  await probeRemoteHandoffReachable().catch(() => false);
  const capabilities = getHandoffCapabilities();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="shortcut icon" href={`${basePath}/favicon.ico`} />
        <link rel="icon" sizes="16x16 32x32 64x64" href={`${basePath}/favicon.ico`} />
        {config?.app?.google_tag_manager && (
          <Script id="google-tag-manager" strategy="afterInteractive">
            {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${config.app.google_tag_manager}');
          `}
          </Script>
        )}
      </head>
      <body>
        {config?.app?.google_tag_manager && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${config.app.google_tag_manager}`}
              height="0"
              width="0"
              title="googleTagManagerNoScript"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        )}
        <Providers config={config} menu={menu} authEnabled={authEnabled} session={session} capabilities={capabilities}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
