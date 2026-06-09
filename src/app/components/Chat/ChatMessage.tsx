'use client';

import { Bot, User } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from './ChatContext';
import { ChatActionCard } from './ChatActionCard';

interface Props {
  message: ChatMessageType;
  basePath?: string;
  onClose?: () => void;
}

export function ChatMessage({ message, basePath, onClose }: Props) {
  const isUser = message.role === 'user';

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
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'rounded-tr-sm bg-primary text-primary-foreground'
              : 'rounded-tl-sm bg-muted text-foreground'
          }`}
        >
          {message.content || (message.streaming ? <StreamingCursor /> : null)}
          {!message.content && !message.streaming && (
            <span className="italic text-muted-foreground">Empty response</span>
          )}
        </div>

        {/* Action cards rendered below the bubble */}
        {message.actions && message.actions.length > 0 && (
          <div className="w-full space-y-1.5">
            {message.actions.map((action, idx) => (
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
