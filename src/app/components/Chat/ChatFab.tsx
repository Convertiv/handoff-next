'use client';

import { Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthUi } from '../context/AuthUiContext';
import { useHandoffCapabilities } from '../context/HandoffCapabilitiesContext';
import { cn } from '../../lib/utils';
import { useChatContext } from './ChatContext';

export function ChatFab() {
  const { aiFeatures } = useHandoffCapabilities();
  const { authEnabled } = useAuthUi();
  const { data: session } = useSession();
  const { toggleChat, isOpen } = useChatContext();
  const pathname = usePathname();

  // Surfaces with their own AI panel, or their own tooling, don't want a floating assistant on top of
  // it — two entry points to "ask the AI" in one screen is a question about which one to use, not a
  // convenience. The workbench and the playground each have a chat sidebar; the library has its own
  // tooling. The app serves both slash forms of every route, so normalize before matching.
  const path = pathname.replace(/\/+$/, '');
  const OWN_SURFACE = ['/design', '/library', '/playground'];
  const hidden = OWN_SURFACE.some((p) => path === p || path.startsWith(`${p}/`));

  if (hidden || !aiFeatures || !authEnabled || !session?.user) return null;

  return (
    <button
      onClick={toggleChat}
      aria-label={isOpen ? 'Close design assistant' : 'Open design assistant'}
      title="Design assistant"
      className={cn(
        'fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border bg-background shadow-md transition-all duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isOpen && 'bg-accent text-accent-foreground border-accent'
      )}
    >
      <Sparkles className="h-[1.1rem] w-[1.1rem]" />
    </button>
  );
}
