'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Link2, Loader2, Sparkles, User } from 'lucide-react';
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
  | { role: 'assistant'; content: string; proposal?: Proposal };

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
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  /**
   * Send a turn and consume its event stream.
   *
   * The server narrates what it is doing — searching, scaffolding, looking for imagery — and each
   * status replaces the last, so the panel reads as one live line rather than an accumulating log.
   * Only the reply and proposal become permanent messages.
   */
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    // Build the outgoing history from the value we're about to set, not from state — state updates
    // are async and the request would otherwise omit the message that triggered it.
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setBusy(true);
    setStatus('Thinking…');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/handoff/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'The request failed.');
      }

      let reply = '';
      let proposal: Proposal | undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Newline-delimited JSON: the last piece may be a partial line, so it stays in the buffer.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { type: string; text?: string; content?: string; message?: string; blocks?: Proposal['blocks']; rationale?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === 'status') setStatus(event.text ?? '');
          else if (event.type === 'reply') reply = event.content ?? '';
          else if (event.type === 'proposal') proposal = { blocks: event.blocks ?? [], rationale: event.rationale ?? '' };
          else if (event.type === 'error') throw new Error(event.message || 'The request failed.');
        }
      }

      if (reply || proposal) {
        setMessages((cur) => [...cur, { role: 'assistant', content: reply, proposal }]);
      }
    } catch (e) {
      // An abort is the user choosing to stop, not a failure to report.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : 'The request failed.');
      }
    } finally {
      abortRef.current = null;
      setStatus('');
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  /**
   * Pull a page's content into the conversation.
   *
   * Extraction happens server-side and the result is sent as an ordinary user turn, so the model
   * composes from it with the same tools it always uses. It is *reference material*, not a layout to
   * be reproduced — mapping scraped HTML onto blocks was the old importer's approach, and it invented
   * structure that was never really there.
   */
  const pullUrl = async () => {
    if (!url.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/handoff/ai/extract-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      });
      const page = (await res.json()) as {
        url?: string;
        title?: string;
        description?: string;
        headings?: { level: number; text: string }[];
        paragraphs?: string[];
        images?: { src: string; alt: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(page.error || 'Could not read that page.');

      const summary = [
        `Here is the content of ${page.url}. Use it as reference — the copy and structure to work from, not a layout to copy.`,
        page.title ? `\nTitle: ${page.title}` : '',
        page.description ? `Description: ${page.description}` : '',
        page.headings?.length ? `\nHeadings:\n${page.headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`).join('\n')}` : '',
        page.paragraphs?.length ? `\nCopy:\n${page.paragraphs.map((t) => `- ${t}`).join('\n')}` : '',
        // Images are listed for context only. They are not in the asset store, so they cannot be used
        // as block imagery — search_assets is the only source, and saying so here stops the model
        // reaching for a foreign URL that would render as a hotlink we do not control.
        page.images?.length
          ? `\nImages on the page (context only — do NOT use these URLs as block imagery; search the asset store instead):\n${page.images.slice(0, 12).map((i) => `- ${i.alt || '(no alt)'}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      setUrl('');
      setUrlOpen(false);
      setBusy(false);
      await send(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that page.');
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
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">{status || 'Thinking…'}</span>
            </div>
            <button
              type="button"
              onClick={stop}
              className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Stop
            </button>
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="space-y-2 border-t p-3">
        {urlOpen ? (
          <div className="flex gap-1.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void pullUrl();
                if (e.key === 'Escape') setUrlOpen(false);
              }}
              placeholder="example.com/pricing"
              disabled={busy}
              autoFocus
              className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs"
            />
            <Button type="button" size="sm" className="h-8 shrink-0 text-xs" disabled={busy || !url.trim()} onClick={() => void pullUrl()}>
              Pull
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setUrlOpen(true)}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Link2 className="h-3 w-3" />
            Pull content from a URL
          </button>
        )}
        <ChatInput onSend={(t) => void send(t)} disabled={busy} />
      </div>
    </div>
  );
}
