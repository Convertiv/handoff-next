'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { AuthUiProvider } from '../components/context/AuthUiContext';
import { ConfigContextProvider } from '../components/context/ConfigContext';
import { ThemeProvider } from '../components/util/theme-provider';
import type { ClientConfig } from '@handoff/types/config';
import type { SectionLink } from '../components/util';
import { HandoffCapabilitiesProvider } from '../components/context/HandoffCapabilitiesContext';
import type { HandoffCapabilities } from '../lib/handoff-capabilities';
import { ChatProvider } from '../components/Chat/ChatContext';
import { ChatDrawer } from '../components/Chat/ChatDrawer';
import { ChatFab } from '../components/Chat/ChatFab';

interface ProvidersProps {
  config: ClientConfig;
  menu: SectionLink[];
  children: ReactNode;
  authEnabled?: boolean;
  session?: Session | null;
  capabilities: HandoffCapabilities;
}

export default function Providers({
  config,
  menu,
  children,
  authEnabled = false,
  session = null,
  capabilities,
}: ProvidersProps) {
  const basePath = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

  /**
   * `/s/*` is the public share surface — the read-only viewer and the guest authoring page. Both are
   * standalone by design (no nav, no session, no owner data), so the design-system assistant does not
   * belong there: it is an authenticated feature, its API rejects an unauthenticated caller, and on the
   * guest page it invites someone with no account to ask a chat that cannot answer them.
   *
   * `usePathname()` returns the path without the app base path, so this comparison is base-path safe.
   */
  const pathname = usePathname();
  /**
   * Surfaces that deliberately carry no app chrome: the public share pages (`/s/*`).
   *
   * `/briefs/*` used to be listed here too. It is now only a redirect into `/playground/{id}?brief=` (roadmap
   * E.8), and a brief is a *level of a page* rather than its own screen — so it gets the same chrome the page
   * does. What keeps a brief from offering authoring it cannot honour is `aiAssistantEnabled: false` and a
   * read-only canvas, decided per level in `PlaygroundWorkbench`, not the absence of app chrome.
   */
  const isChromeless = pathname === '/s' || pathname?.startsWith('/s/');

  return (
    <SessionProvider session={session ?? undefined}>
      <AuthUiProvider authEnabled={authEnabled}>
        <HandoffCapabilitiesProvider capabilities={capabilities}>
          <ConfigContextProvider defaultConfig={config} defaultMenu={menu}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
              <ChatProvider>
                {children}
                {capabilities.aiFeatures && !isChromeless && <ChatDrawer basePath={basePath} />}
                {!isChromeless && <ChatFab />}
              </ChatProvider>
            </ThemeProvider>
          </ConfigContextProvider>
        </HandoffCapabilitiesProvider>
      </AuthUiProvider>
    </SessionProvider>
  );
}
