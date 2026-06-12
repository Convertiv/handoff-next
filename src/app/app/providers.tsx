'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
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

  return (
    <SessionProvider session={session ?? undefined}>
      <AuthUiProvider authEnabled={authEnabled}>
        <HandoffCapabilitiesProvider capabilities={capabilities}>
          <ConfigContextProvider defaultConfig={config} defaultMenu={menu}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
              <ChatProvider>
                {children}
                {capabilities.aiFeatures && <ChatDrawer basePath={basePath} />}
                <ChatFab />
              </ChatProvider>
            </ThemeProvider>
          </ConfigContextProvider>
        </HandoffCapabilitiesProvider>
      </AuthUiProvider>
    </SessionProvider>
  );
}
