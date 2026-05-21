'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { HandoffCapabilities } from '@/lib/handoff-capabilities';

const HandoffCapabilitiesContext = createContext<HandoffCapabilities | null>(null);

export function HandoffCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: HandoffCapabilities;
  children: ReactNode;
}) {
  return (
    <HandoffCapabilitiesContext.Provider value={capabilities}>{children}</HandoffCapabilitiesContext.Provider>
  );
}

export function useHandoffCapabilities(): HandoffCapabilities {
  const ctx = useContext(HandoffCapabilitiesContext);
  if (!ctx) {
    return {
      localFilesystem: true,
      hasRemoteApi: false,
      hasRemoteAuth: false,
      remoteReachable: null,
      designWorkbench: false,
      designLibrary: false,
      aiFeatures: false,
      adminBuildLogs: false,
      adminAiCost: false,
      adminUsers: false,
      figmaOAuth: false,
      inAppDbEditing: false,
      mcp: false,
    };
  }
  return ctx;
}
