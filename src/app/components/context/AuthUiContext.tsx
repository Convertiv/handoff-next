'use client';

import { createContext, useContext } from 'react';

const AuthUiContext = createContext<{ authEnabled: boolean }>({ authEnabled: false });

export function AuthUiProvider({ authEnabled, children }: { authEnabled: boolean; children: React.ReactNode }) {
  return <AuthUiContext.Provider value={{ authEnabled }}>{children}</AuthUiContext.Provider>;
}

export function useAuthUi() {
  return useContext(AuthUiContext);
}
