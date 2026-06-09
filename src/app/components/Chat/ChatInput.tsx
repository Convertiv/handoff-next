'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatInput({ onSend, disabled, isStreaming }: Props) {
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

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={isStreaming ? 'Waiting for response…' : 'Ask about components, tokens, patterns…'}
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
        className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30 hover:opacity-90 active:opacity-75"
      >
        {isStreaming ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
