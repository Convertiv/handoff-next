'use client';

import { ReactNode } from 'react';
import { ConfigContextProvider } from '../components/context/ConfigContext';
import { ThemeProvider } from '../components/util/theme-provider';
import type { ClientConfig } from '@handoff/types/config';
import type { SectionLink } from '../components/util';

interface ProvidersProps {
  config: ClientConfig;
  menu: SectionLink[];
  children: ReactNode;
}

export default function Providers({ config, menu, children }: ProvidersProps) {
  return (
    <ConfigContextProvider defaultConfig={config} defaultMenu={menu}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </ConfigContextProvider>
  );
}
