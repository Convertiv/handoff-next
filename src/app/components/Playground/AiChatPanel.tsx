'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/Chat/ChatInput';
import { usePlayground } from './PlaygroundContext';

/**
 * Build-a-page chat for the playground.
 *
 * Reuses `ChatInput` from the workbench chat — it is genuinely generic (`onSend`, `disabled`). It does
 * **not** reuse `ChatMessage`, which is bound to the workbench's `ChatContext` action union and would
 * drag navigation cards and component grids in with it. Playground messages are simpler: prose, plus
 * at most one proposal. Reuse what is actually shared; don't force-fit the rest.
 *
 * **The chat proposes, this applies.** The server returns blocks and never writes a pattern. Applying
 * calls `bulkAddComponents`, so the page assembles in the preview the user is already looking at and
 * every existing affordance — drag, edit sheet, save — keeps working on the result.
 */

type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; proposal?: Proposal; toolsUsed?: string[] };

interface Proposal {
  blocks: { componentId: string; args: Record<string, unknown> }[];
  rationale: string;
  /** Set once applied, so the card stops offering to do it again. */
  applied?: boolean;
}

export default function AiChatPanel() {
  const { bulkAddComponents, selectedComponents } = usePlayground();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    // Build the outgoing history from the value we're about to set, not from state — state updates
    // are async and the request would otherwise omit the message that triggered it.
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch('/api/handoff/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const json = (await res.json()) as {
        reply?: string;
        proposal?: Proposal;
        toolsUsed?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || 'The request failed.');
      setMessages((cur) => [
        ...cur,
        { role: 'assistant', content: json.reply ?? '', proposal: json.proposal, toolsUsed: json.toolsUsed },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (index: number, proposal: Proposal, replace: boolean) => {
    await bulkAddComponents(
      proposal.blocks.map((b) => ({ componentId: b.componentId, data: b.args })),
      replace
    );
    setMessages((cur) =>
      cur.map((m, i) => (i === index && m.role === 'assistant' && m.proposal ? { ...m, proposal: { ...m.proposal, applied: true } } : m))
    );
  };

  const canvasHasBlocks = selectedComponents.length > 0;

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Build with AI</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Describe the page you want.</p>
            <p className="mt-1.5">
              It composes from blocks that already exist, writes the copy in your brand voice, and uses
              images from your asset library. It may ask a question first.
            </p>
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="mt-0.5 shrink-0">
              {m.role === 'user' ? (
                <User className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {m.content ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p> : null}

              {m.role === 'assistant' && m.proposal ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium">
                    {m.proposal.blocks.length} block{m.proposal.blocks.length === 1 ? '' : 's'}
                  </p>
                  <ol className="mt-1.5 space-y-0.5">
                    {m.proposal.blocks.map((b, bi) => (
                      <li key={bi} className="truncate text-xs text-muted-foreground">
                        {bi + 1}. <code className="rounded bg-muted px-1">{b.componentId}</code>
                      </li>
                    ))}
                  </ol>

                  {m.proposal.applied ? (
                    <p className="mt-2.5 text-xs text-emerald-700 dark:text-emerald-400">Added to the page.</p>
                  ) : (
                    // Two buttons rather than one when the canvas already has blocks: "apply" is
                    // ambiguous there, and guessing wrong either discards the user's work or leaves a
                    // page they have to clean up by hand.
                    <div className="mt-2.5 flex gap-2">
                      <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void apply(i, m.proposal!, false)}>
                        {canvasHasBlocks ? 'Add to page' : 'Build page'}
                      </Button>
                      {canvasHasBlocks ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => void apply(i, m.proposal!, true)}
                        >
                          Replace page
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {/* Showing its working: which blocks it looked at, whether it consulted the asset store. */}
              {m.role === 'assistant' && m.toolsUsed?.length ? (
                <p className="text-[11px] text-muted-foreground">{summarizeTools(m.toolsUsed)}</p>
              ) : null}
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Looking through your blocks…
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="border-t p-3">
        <ChatInput onSend={(t) => void send(t)} disabled={busy} />
      </div>
    </div>
  );
}

/** Turn the raw tool list into one readable line — "searched blocks · scaffolded 3 · checked assets". */
function summarizeTools(tools: string[]): string {
  const count = (n: string) => tools.filter((t) => t === n).length;
  const parts: string[] = [];
  if (count('search_components')) parts.push('searched blocks');
  const scaffolds = count('scaffold_args');
  if (scaffolds) parts.push(`scaffolded ${scaffolds}`);
  if (count('search_assets')) parts.push('checked assets');
  return parts.join(' · ');
}
