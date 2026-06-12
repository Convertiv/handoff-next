'use client';

import { Sparkles } from 'lucide-react';
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

  if (!aiFeatures || !authEnabled || !session?.user) return null;

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
