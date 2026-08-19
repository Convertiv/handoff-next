import Script from 'next/script';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '../lib/auth';
import { getDataProvider } from '../lib/data';
import { isPostgres } from '../lib/db/dialect';
import { getHandoffCapabilities, probeRemoteHandoffReachable } from '../lib/handoff-capabilities';
import { getMergedRuntimeConfig } from '../lib/server/runtime-config';
import Providers from './providers';
import '../css/index.css';
import '../css/theme.css';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve runtime config (per-project metadata). Workspace mode reads from
  // filesystem; registry mode reads from handoff_registry_config and merges
  // over the static defaults. See ADR-001 §1.
  const config = await getMergedRuntimeConfig();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const authEnabled = isPostgres();

  // First-run check: registry mode with no users → send to /setup.
  // Uses x-pathname header injected by middleware (no extra DB query on every request
  // once users exist — early-exit on the no-DB or non-zero-user paths).
  if (authEnabled) {
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? '/';
    if (!pathname.startsWith('/setup') && !pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
      try {
        // Cached: once users exist this is permanently non-zero, so we don't
        // need a live COUNT(*) on every request. Invalidated on setup.
        const { getCachedUserCount } = await import('../lib/server/registry-cache');
        const userCount = await getCachedUserCount();
        if (userCount === 0) redirect('/setup');
      } catch {
        // DB unreachable — don't block; request errors will surface naturally
      }
    }
  }

  const menu = await getDataProvider().getMenu();
  const session = await auth().catch(() => null);

  /**
   * Site password (`docs/SITE-PASSWORD.md`).
   *
   * Gated here rather than in `proxy.ts` for two reasons. The proxy runs on Edge and cannot reach Postgres or
   * bcrypt — it says so itself — and, more importantly, everything that must stay reachable is exempt here
   * *structurally*: API routes, `_next` and assets never render this layout. That is what keeps the preview
   * canvas alive, since its iframe is opaque-origin and its requests for component CSS and JS carry no cookies
   * and could never satisfy a gate.
   *
   * Runs after `session` so a signed-in user is never asked for a shared secret they may not have been given.
   */
  if (authEnabled) {
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? '/';
    const { getProtectionState } = await import('../lib/server/site-protection');
    const state = await getProtectionState();
    if (state.enabled) {
      const { decideGate } = await import('../lib/site-gate');
      const { readUnlock, UNLOCK_COOKIE } = await import('../lib/server/unlock-cookie');
      const { cookies } = await import('next/headers');
      const jar = await cookies();
      const decision = decideGate({
        pathname,
        enabled: true,
        hasSession: Boolean(session?.user),
        unlocked: readUnlock(jar.get(UNLOCK_COOKIE)?.value, state.epoch),
      });
      if (decision.gate) {
        // The path is carried so unlocking returns you where you were aiming.
        redirect(`/unlock?next=${encodeURIComponent(pathname)}`);
      }
    }
  }
  await probeRemoteHandoffReachable().catch(() => false);
  const capabilities = getHandoffCapabilities();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="shortcut icon" href={`${basePath}/favicon.ico`} />
        <link rel="icon" sizes="16x16 32x32 64x64" href={`${basePath}/favicon.ico`} />
        {/*
          Inter is loaded here rather than via `@import` in css/index.css —
          Turbopack drops remote CSS imports during compilation, which left the
          app rendering in the system fallback font.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
        />
        {/*
          Registry mode: layer the DB-pushed theme CSS over the bundled defaults.
          Workspace mode: this 404s harmlessly (no DB) and the browser ignores it.
          ADR-001 §2 — theme is compiled in the workspace and pushed as bytes.
        */}
        {authEnabled && <link rel="stylesheet" href={`${basePath}/api/registry/theme.css`} />}
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
