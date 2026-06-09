'use client';

import { useRouter } from 'next/navigation';
import { Bot, User } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from './ChatContext';
import { ChatActionCard } from './ChatActionCard';
import { ChatComponentGrid } from './ChatComponentGrid';
import { ChatChangelogFeed } from './ChatChangelogFeed';
import { ChatValidationPanel } from './ChatValidationPanel';

interface Props {
  message: ChatMessageType;
  basePath?: string;
  onClose?: () => void;
}

export function ChatMessage({ message, basePath, onClose }: Props) {
  const isUser = message.role === 'user';
  const router = useRouter();

  // Inline rich actions — rendered below the bubble, full-width
  const gridActions = message.actions?.filter((a) => a.type === 'show_components') ?? [];
  const changelogActions = message.actions?.filter((a) => a.type === 'get_recent_changes') ?? [];
  const validationActions = message.actions?.filter((a) => a.type === 'check_validation') ?? [];

  // Standard action cards — everything else
  const inlineTypes = new Set(['show_components', 'get_recent_changes', 'check_validation']);
  const cardActions = message.actions?.filter((a) => !inlineTypes.has(a.type)) ?? [];

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

        {/* Changelog feed */}
        {changelogActions.map((_action, idx) => (
          <ChatChangelogFeed key={idx} basePath={basePath} onClose={onClose} />
        ))}

        {/* Validation panels */}
        {validationActions.map((action, idx) =>
          action.type === 'check_validation' ? (
            <ChatValidationPanel
              key={idx}
              componentId={action.componentId}
              componentTitle={action.componentTitle}
              basePath={basePath}
              onNavigate={() => {
                router.push(`${basePath ?? ''}/system/component/${encodeURIComponent(action.componentId)}`);
                onClose?.();
              }}
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
