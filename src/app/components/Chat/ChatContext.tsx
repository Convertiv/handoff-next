'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { handoffApiUrl } from '@/lib/api-path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComponentCardRef {
  id: string;
  title: string;
  group: string;
  description: string;
  screenshotUrl: string;
}

export type ChatAction =
  | { type: 'navigate_component'; id: string; title: string; reason?: string }
  | { type: 'navigate_pattern'; id: string; title: string; reason?: string }
  | { type: 'open_playground'; description: string }
  | { type: 'open_design_workbench'; description: string; componentId?: string; generationPrompt?: string }
  | { type: 'show_components'; components: ComponentCardRef[]; recommendation?: string; recommendationReason?: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Set to true while streaming */
  streaming?: boolean;
  actions?: ChatAction[];
}

export interface PageContext {
  type: 'component' | 'pattern';
  id: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ChatCtx = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

// ─── Page context detection ────────────────────────────────────────────────

function usePageContext(): PageContext | undefined {
  const pathname = usePathname();
  if (!pathname) return undefined;
  const componentMatch = pathname.match(/\/system\/component\/([^/]+)/);
  if (componentMatch) return { type: 'component', id: decodeURIComponent(componentMatch[1]) };
  const patternMatch = pathname.match(/\/system\/pattern\/([^/]+)/);
  if (patternMatch) return { type: 'pattern', id: decodeURIComponent(patternMatch[1]) };
  return undefined;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pageContext = usePageContext();
  const abortRef = useRef<AbortController | null>(null);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => {
    setIsOpen(false);
    abortRef.current?.abort();
  }, []);
  const toggleChat = useCallback(() => setIsOpen((o) => !o), []);
  const clearHistory = useCallback(() => setMessages([]), []);

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', streaming: true, actions: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Build the messages array for the API (exclude the empty in-progress assistant message)
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: ctrl.signal,
        body: JSON.stringify({ messages: history, pageContext }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const errorMsg = data.error ?? `Server error (${res.status})`;
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: errorMsg, streaming: false } : m)
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimLine = line.trim();
          if (!trimLine) continue;
          try {
            const event = JSON.parse(trimLine) as { type: string; content?: string; action?: ChatAction };
            if (event.type === 'delta' && event.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + event.content! } : m
                )
              );
            } else if (event.type === 'action' && event.action) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, actions: [...(m.actions ?? []), event.action!] } : m
                )
              );
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: (event as any).message ?? 'An error occurred.', streaming: false } : m
                )
              );
            } else if (event.type === 'done') {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
              );
            }
          } catch {
            // malformed JSON line — skip
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : 'Connection error';
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: msg, streaming: false } : m)
      );
    } finally {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId && m.streaming ? { ...m, streaming: false } : m)
      );
    }
  }, [isStreaming, messages, pageContext]);

  return (
    <ChatCtx.Provider value={{ messages, isStreaming, isOpen, openChat, closeChat, toggleChat, sendMessage, clearHistory }}>
      {children}
    </ChatCtx.Provider>
  );
}
