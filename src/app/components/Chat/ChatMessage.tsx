'use client';

import { Bot, User } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from './ChatContext';
import { ChatActionCard } from './ChatActionCard';
import { ChatComponentGrid } from './ChatComponentGrid';

interface Props {
  message: ChatMessageType;
  basePath?: string;
  onClose?: () => void;
}

export function ChatMessage({ message, basePath, onClose }: Props) {
  const isUser = message.role === 'user';

  // Split actions: show_components renders inline as a grid, others render as cards
  const gridActions = message.actions?.filter((a) => a.type === 'show_components') ?? [];
  const cardActions = message.actions?.filter((a) => a.type !== 'show_components') ?? [];

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble + actions */}
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Text bubble — omit if empty and streaming hasn't started */}
        {(message.content || message.streaming) && (
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'rounded-tr-sm bg-primary text-primary-foreground'
                : 'rounded-tl-sm bg-muted text-foreground'
            }`}
          >
            {message.content || (message.streaming ? <StreamingCursor /> : null)}
          </div>
        )}

        {/* Component grids render full-width below the bubble */}
        {gridActions.map((action, idx) =>
          action.type === 'show_components' ? (
            <ChatComponentGrid
              key={idx}
              components={action.components}
              recommendation={action.recommendation}
              recommendationReason={action.recommendationReason}
              basePath={basePath}
              onClose={onClose}
            />
          ) : null
        )}

        {/* Standard action cards */}
        {cardActions.length > 0 && (
          <div className="w-full space-y-1.5">
            {cardActions.map((action, idx) => (
              <ChatActionCard
                key={idx}
                action={action}
                basePath={basePath}
                onClose={onClose}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="inline-block h-3.5 w-0.5 animate-pulse bg-current opacity-70" />
    </span>
  );
}
