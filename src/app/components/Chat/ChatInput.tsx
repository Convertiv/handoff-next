'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  variant?: 'default' | 'rail';
  onAttach?: () => void;
}

export function ChatInput({ onSend, disabled, isStreaming, placeholder, variant = 'default', onAttach }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !disabled && !isStreaming;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  if (variant === 'rail') {
    return (
      <div>
        <div className="px-1 pt-1.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={isStreaming ? 'Waiting for response…' : (placeholder ?? 'Describe the page you want...')}
            disabled={disabled || isStreaming}
            rows={1}
            className="max-h-40 w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-50"
            style={{ overflowY: 'auto' }}
          />
        </div>
        <div className="flex items-center justify-end gap-1 px-1 pb-1 pt-2">
          {onAttach ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={onAttach}
              disabled={disabled || isStreaming}
              aria-label="Attach a file"
              title="Attach a file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            className="rounded-full"
            onClick={isStreaming ? undefined : submit}
            disabled={!canSend && !isStreaming}
            title={isStreaming ? 'Streaming…' : 'Send (Enter)'}
            aria-label={isStreaming ? 'Streaming response' : 'Send message'}
          >
            {isStreaming ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={isStreaming ? 'Waiting for response…' : (placeholder ?? 'Ask about components, tokens, patterns…')}
        disabled={disabled || isStreaming}
        rows={1}
        className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        style={{ maxHeight: '160px', overflowY: 'auto' }}
      />
      <button
        type="button"
        onClick={isStreaming ? undefined : submit}
        disabled={!canSend && !isStreaming}
        title={isStreaming ? 'Streaming…' : 'Send (Enter)'}
        className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-30"
      >
        {isStreaming ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
