'use client';

import { useEffect, useRef } from 'react';
import { X, Trash2, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChatContext } from './ChatContext';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

interface Props {
  basePath?: string;
}

export function ChatDrawer({ basePath }: Props) {
  const { messages, isStreaming, isOpen, closeChat, sendMessage, clearHistory } = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  // Auto-scroll to bottom on new messages or when content grows
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    const newMessages = messages.length > prevMsgCount.current;
    if (newMessages || isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCount.current = messages.length;
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChat();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closeChat]);

  return (
    <>
      {/* Backdrop (mobile only) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={closeChat}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel — hidden off-screen when closed; pointer-events disabled so it cannot block nav clicks */}
      <div
        role="dialog"
        aria-label="Design system assistant"
        aria-modal={isOpen}
        aria-hidden={!isOpen}
        className={cn(
          'fixed bottom-0 right-0 flex flex-col',
          'w-full md:w-[420px] md:max-w-[50vw]',
          'h-[85dvh] md:h-[calc(100dvh-4rem)]',
          'bg-background border-l border-t border-border shadow-xl',
          'rounded-tl-2xl md:rounded-tl-2xl md:rounded-tr-none',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'z-50 translate-y-0 md:translate-x-0' : 'z-40 pointer-events-none translate-y-full md:translate-y-0 md:translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-semibold">Design Assistant</span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              title="Clear conversation"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={closeChat}
            title="Close assistant"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                basePath={basePath}
                onClose={closeChat}
              />
            ))
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-border px-4 py-3">
          <ChatInput onSend={sendMessage} isStreaming={isStreaming} />
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            AI can make mistakes. Always verify important information.
          </p>
        </div>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Ask about your design system</p>
        <p className="max-w-[240px] text-xs text-muted-foreground">
          Ask about components, tokens, and patterns — or request help building something new.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <SuggestionChip key={s} text={s} />
        ))}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'What button variants do I have?',
  'Show me the color tokens',
  'Build a hero section',
  'What patterns are available?',
];

function SuggestionChip({ text }: { text: string }) {
  const { sendMessage } = useChatContext();
  return (
    <button
      type="button"
      onClick={() => sendMessage(text)}
      className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {text}
    </button>
  );
}
