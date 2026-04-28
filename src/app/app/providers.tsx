'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { ReactNode } from 'react';
import { AuthUiProvider } from '../components/context/AuthUiContext';
import { ConfigContextProvider } from '../components/context/ConfigContext';
import { ThemeProvider } from '../components/util/theme-provider';
import type { ClientConfig } from '@handoff/types/config';
import type { SectionLink } from '../components/util';

interface ProvidersProps {
  config: ClientConfig;
  menu: SectionLink[];
  children: ReactNode;
  authEnabled?: boolean;
  session?: Session | null;
}

export default function Providers({ config, menu, children, authEnabled = false, session = null }: ProvidersProps) {
  return (
    <SessionProvider session={session ?? undefined}>
      <AuthUiProvider authEnabled={authEnabled}>
        <ConfigContextProvider defaultConfig={config} defaultMenu={menu}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
          </ThemeProvider>
        </ConfigContextProvider>
      </AuthUiProvider>
    </SessionProvider>
  );
}
