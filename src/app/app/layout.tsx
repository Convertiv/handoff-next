import Script from 'next/script';
import { getClientRuntimeConfig, staticBuildMenu } from '../components/util';
import { auth } from '../lib/auth';
import { getMode } from '../lib/mode';
import Providers from './providers';
import '../css/index.css';
import '../css/theme.css';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getClientRuntimeConfig();
  const menu = staticBuildMenu();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const authEnabled = getMode() === 'dynamic';
  const session = authEnabled ? await auth().catch(() => null) : null;

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
        <Providers config={config} menu={menu} authEnabled={authEnabled} session={session}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
