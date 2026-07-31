'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, Loader2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import { ChatInput } from '@/components/Chat/ChatInput';
import { componentThumbnailUrl } from '@/lib/component-thumbnail';
import { applyOps, describeOp, verifyOps, type EditOp, type PageBlock } from '@/lib/edit-operations';
import { containsImageSrc, swapImageSrc } from '@/lib/swap-image-src';
import { usePlayground } from './PlaygroundContext';

/**
 * Build-a-page chat for the playground.
 *
 * Reuses `ChatInput` from the workbench chat — it is genuinely generic (`onSend`, `disabled`) — and the
 * `Message`/`Bubble` primitives for turn layout. It does **not** reuse `ChatMessage`, which is bound to
 * the workbench's `ChatContext` action union and would drag navigation cards and component grids in
 * with it. Playground messages are simpler: prose, plus at most one proposal. Reuse what is actually
 * shared; don't force-fit the rest.
 *
 * **The chat proposes, this applies.** The server returns blocks and never writes a pattern. Applying
 * calls `bulkAddComponents`, so the page assembles in the preview the user is already looking at and
 * every existing affordance — drag, edit sheet, save — keeps working on the result.
 */

type Msg =
  | {
      role: 'user';
      content: string;
      /**
       * Shown in place of `content` when the turn was assembled for the model rather than typed. A
       * pulled URL sends the whole extracted page as a user turn; the model needs all of it in history,
       * but rendering it verbatim puts hundreds of words the user never wrote in the transcript.
       */
      label?: string;
    }
  | { role: 'assistant'; content: string; proposal?: Proposal; changeset?: Changeset; images?: PendingImage[] };

/**
 * An image being generated for a slot that is currently showing a placeholder.
 *
 * Generation is 25s-4min and the chat route budget is 120s, so the turn cannot wait for it — the page
 * is applied with placeholders and these fill in behind it. See `docs/PLAYGROUND-ASSETS.md`.
 */
interface PendingImage {
  jobId: number;
  title: string;
  placeholderSrc: string;
  state: 'generating' | 'done' | 'failed' | 'gone';
  error?: string;
}

interface Changeset {
  ops: EditOp[];
  summary: string;
  rejected: { reason: string }[];
  applied?: boolean;
  /** The page as it was before applying, so a single Undo can put it back. */
  undo?: PageBlock[];
}

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
  /** Serializes canvas writes from image watchers — see `watchImage`. */
  const swapQueue = useRef<Promise<void>>(Promise.resolve());

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
  const send = async (text: string, label?: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    // Build the outgoing history from the value we're about to set, not from state — state updates
    // are async and the request would otherwise omit the message that triggered it.
    const next: Msg[] = [...messages, { role: 'user', content: text, label }];
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
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          // So a follow-up can say "make the hero shorter" and mean the one on screen.
          currentBlocks: selectedComponents.map((c) => ({ componentId: c.id, args: c.data ?? {} })),
        }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'The request failed.');
      }

      let reply = '';
      let proposal: Proposal | undefined;
      let changeset: Changeset | undefined;
      let images: PendingImage[] | undefined;
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
          let event: {
            type: string;
            text?: string;
            content?: string;
            message?: string;
            blocks?: Proposal['blocks'];
            rationale?: string;
            ops?: EditOp[];
            summary?: string;
            rejected?: { reason: string }[];
            queued?: { jobId: number; title: string; placeholderSrc: string }[];
          };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === 'status') setStatus(event.text ?? '');
          else if (event.type === 'reply') reply = event.content ?? '';
          else if (event.type === 'proposal') proposal = { blocks: event.blocks ?? [], rationale: event.rationale ?? '' };
          else if (event.type === 'changeset')
            changeset = { ops: event.ops ?? [], summary: event.summary ?? '', rejected: event.rejected ?? [] };
          else if (event.type === 'images')
            images = (event.queued ?? []).map((q) => ({ ...q, state: 'generating' as const }));
          else if (event.type === 'error') throw new Error(event.message || 'The request failed.');
        }
      }

      if (reply || proposal || changeset || images?.length) {
        // The index the poller needs to patch is this message's, which is only known once it is in
        // the list — hence the functional update returning it rather than computing it from state.
        let msgIndex = -1;
        setMessages((cur) => {
          msgIndex = cur.length;
          return [...cur, { role: 'assistant', content: reply, proposal, changeset, images }];
        });
        // Generation is already running server-side; these watchers only decide when the canvas
        // learns about it. Deliberately not awaited — the turn is over.
        if (images?.length && msgIndex >= 0) {
          for (const image of images) void watchImage(msgIndex, image);
        }
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
      // The model gets the whole extraction; the transcript shows what the user actually asked for.
      await send(summary, `Pull content from ${page.url || url}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that page.');
      setBusy(false);
    }
  };

  /** Which block is being refined: message index, block index, and the pending instruction. */
  const [refining, setRefining] = useState<{ msg: number; block: number } | null>(null);
  const [refineText, setRefineText] = useState('');
  const [refineBusy, setRefineBusy] = useState(false);

  const updateProposal = (msgIndex: number, fn: (p: Proposal) => Proposal) =>
    setMessages((cur) =>
      cur.map((m, i) => (i === msgIndex && m.role === 'assistant' && m.proposal ? { ...m, proposal: fn(m.proposal) } : m))
    );

  /** Drop a block. No model call — the user has already decided. */
  const removeBlock = (msgIndex: number, blockIndex: number) =>
    updateProposal(msgIndex, (p) => ({ ...p, blocks: p.blocks.filter((_, i) => i !== blockIndex) }));

  /**
   * Ask for a different block in one slot.
   *
   * Scoped server-side to a single block, so the rest of the proposal cannot drift while you are
   * fixing one thing — which is the whole complaint about all-or-nothing regeneration.
   */
  const refineBlock = async (msgIndex: number, blockIndex: number, instruction: string) => {
    const msg = messages[msgIndex];
    if (msg?.role !== 'assistant' || !msg.proposal || refineBusy) return;
    setRefineBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/handoff/ai/playground-chat/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ blocks: msg.proposal.blocks, index: blockIndex, instruction }),
      });
      const json = (await res.json()) as { ok?: boolean; block?: Proposal['blocks'][number]; error?: string };
      if (!res.ok || !json.block) throw new Error(json.error || 'Could not change that block.');
      updateProposal(msgIndex, (p) => ({
        ...p,
        blocks: p.blocks.map((b, i) => (i === blockIndex ? json.block! : b)),
      }));
      setRefining(null);
      setRefineText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that block.');
    } finally {
      setRefineBusy(false);
    }
  };

  const currentPage = (): PageBlock[] =>
    selectedComponents.map((c) => ({ componentId: c.id, args: (c.data ?? {}) as Record<string, unknown> }));

  /**
   * Watch a generation job and drop the finished image into the page.
   *
   * Polling rather than streaming: the job outlives the request that started it, by design, and may
   * outlive the chat turn by minutes. A 3s poll against a job that takes 1-4 minutes is cheap, and it
   * survives the user navigating away and coming back mid-generation in a way an open socket does not.
   *
   * The ceiling matches the cron reaper, so a job the server has given up on stops being polled at
   * roughly the same time rather than spinning until the tab closes.
   */
  const watchImage = async (msgIndex: number, image: PendingImage) => {
    const deadline = Date.now() + 15 * 60 * 1000;
    const setState = (patch: Partial<PendingImage>) =>
      setMessages((cur) =>
        cur.map((m, i) =>
          i === msgIndex && m.role === 'assistant' && m.images
            ? { ...m, images: m.images.map((img) => (img.jobId === image.jobId ? { ...img, ...patch } : img)) }
            : m
        )
      );

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      let job: { status?: string; imageUrl?: string | null; error?: string | null } | undefined;
      try {
        const res = await fetch(`/api/handoff/ai/design-generation-job/${image.jobId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        ({ job } = (await res.json()) as { job: typeof job });
      } catch {
        // A blip is not a failure — the job is still running server-side. Keep polling until the
        // deadline; the only thing a transient error should cost is one interval.
        continue;
      }
      if (!job || job.status === 'pending' || job.status === 'running') continue;

      if (job.status !== 'done' || !job.imageUrl) {
        setState({ state: 'failed', error: job.error ?? 'Generation failed.' });
        return;
      }

      // Serialized against the other watchers. A turn commonly generates two or three images, and
      // `bulkAddComponents` rewrites the whole page: two watchers that each read the canvas and then
      // write it back would have the second silently undo the first's swap. Chaining means each one
      // reads a canvas that already includes every swap before it.
      const url = job.imageUrl;
      swapQueue.current = swapQueue.current.then(async () => {
        // Read *inside* the chain, not before it. Matching by value is also what makes this safe
        // against the user: they may have deleted the block, set their own image, or started a new
        // page in the minutes this took — the same reason edit operations carry `expect`. If the
        // placeholder is gone the image is still in the asset library; it just has nowhere to go.
        const page = currentPage();
        if (!page.some((b) => containsImageSrc(b.args, image.placeholderSrc))) {
          setState({ state: 'gone' });
          return;
        }
        const swapped = page.map((b) => {
          const { value } = swapImageSrc(b.args, image.placeholderSrc, url);
          return { componentId: b.componentId, data: value };
        });
        await bulkAddComponents(swapped, true);
        setState({ state: 'done' });
      });
      // A throw here would break the chain for every later swap, so it is absorbed.
      swapQueue.current = swapQueue.current.catch((err) => {
        console.error('[playground] image swap failed', err);
      });
      return;
    }
    setState({ state: 'failed', error: 'Timed out waiting for the image.' });
  };

  /**
   * Apply a changeset to the canvas.
   *
   * Verified again here, not just on the server: the canvas is the truth and it may have moved since
   * the model planned the edit — someone dragged a block, or applied a previous changeset. Whatever
   * still matches is applied and the rest is reported, because one stale index should not throw away
   * the other four edits.
   *
   * The whole list is rebuilt in one call rather than surgically patched. Simpler, atomic, and it makes
   * undo a single restore.
   */
  const applyChangeset = async (msgIndex: number, changeset: Changeset) => {
    const before = currentPage();
    const { valid, rejected } = verifyOps(changeset.ops, before);

    if (!valid.length) {
      setError(rejected[0]?.reason ?? 'The page changed — ask again and I will re-read it.');
      return;
    }

    const after = applyOps(before, valid);
    await bulkAddComponents(after.map((b) => ({ componentId: b.componentId, data: b.args })), true);

    setMessages((cur) =>
      cur.map((m, i) =>
        i === msgIndex && m.role === 'assistant' && m.changeset
          ? { ...m, changeset: { ...m.changeset, applied: true, undo: before, rejected: [...m.changeset.rejected, ...rejected.map((r) => ({ reason: r.reason }))] } }
          : m
      )
    );
  };

  /** Put the page back exactly as it was. Cheap to build, and the reason people will trust this. */
  const undoChangeset = async (msgIndex: number, changeset: Changeset) => {
    if (!changeset.undo) return;
    await bulkAddComponents(changeset.undo.map((b) => ({ componentId: b.componentId, data: b.args })), true);
    setMessages((cur) =>
      cur.map((m, i) =>
        i === msgIndex && m.role === 'assistant' && m.changeset
          ? { ...m, changeset: { ...m.changeset, applied: false, undo: undefined } }
          : m
      )
    );
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

      {/* gap, not space-y: user turns add their own top margin and gap composes with that. */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Describe the page you want.</p>
            <p className="mt-1.5">
              It composes from blocks that already exist, writes the copy in your brand voice, and uses
              images from your asset library. It may ask a question first.
            </p>
          </div>
        ) : null}

        {/* Turns are told apart by shape, not by an icon: the user is a filled bubble pushed right (the
            workbench and design chats read the same way), the assistant is unbubbled prose running the
            full width of the rail. Two things follow that matter at 340px — the assistant keeps every
            pixel for its proposal card, and that card is never nested inside a filled bubble fighting it
            for figure/ground. Avatars are dropped: at this width a 32px gutter on every turn costs more
            than the two icons were telling anyone.

            `secondary` rather than the workbench's solid `primary`. Primary here is near-black in light
            and near-white in dark, which is also exactly the proposal card's Build-page button — a bubble
            is far larger than a button, so the two together cost the CTA its primacy. `muted` is the
            card's own fill. Secondary is filled and unmistakably a bubble without being either.
            (`tinted` is not an option: it resolves `oklch(from var(--primary) …)` and this app's
            `--primary` is a bare HSL triplet, so the declaration is invalid and no background renders.) */}
        {messages.map((m, i) => (
          <Message
            key={i}
            align={m.role === 'user' ? 'end' : 'start'}
            // Extra air ahead of each new question, so an exchange reads as one group.
            className={m.role === 'user' && i > 0 ? 'mt-2' : undefined}
          >
            <MessageContent>
              {/* The visual cue is silent to a screen reader, so name the speaker. */}
              <span className="sr-only">{m.role === 'user' ? 'You said:' : 'Assistant said:'}</span>

              {m.role === 'user' ? (
                <Bubble variant="secondary" align="end">
                  <BubbleContent className="whitespace-pre-wrap">{m.label ?? m.content}</BubbleContent>
                </Bubble>
              ) : m.content ? (
                <Bubble variant="ghost">
                  <BubbleContent className="whitespace-pre-wrap">{m.content}</BubbleContent>
                </Bubble>
              ) : null}

              {m.role === 'assistant' && m.images?.length ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium">
                    {m.images.length === 1 ? 'Generating an image' : `Generating ${m.images.length} images`}
                  </p>
                  {/* The page is already on the canvas with placeholders; this is progress, not a
                      gate. Saying so stops it reading as "the page is not ready yet". */}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    The page is ready — these swap in as they finish, and land in your asset library.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {m.images.map((img) => (
                      <li key={img.jobId} className="flex items-center gap-1.5 text-xs">
                        {img.state === 'generating' ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                        ) : img.state === 'done' ? (
                          <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">!</span>
                        )}
                        <span className={img.state === 'done' ? '' : 'text-muted-foreground'}>{img.title}</span>
                        {img.state === 'failed' ? (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400">
                            — {img.error ?? 'failed'}; the placeholder stays
                          </span>
                        ) : null}
                        {/* Not an error: the image was made and saved, the slot just moved on. */}
                        {img.state === 'gone' ? (
                          <span className="text-[11px] text-muted-foreground">
                            — that block changed, so it is in your library instead
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {m.role === 'assistant' && m.changeset ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium">
                    {m.changeset.ops.length} change{m.changeset.ops.length === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {m.changeset.ops.map((op, oi) => (
                      <li key={oi} className="text-xs text-muted-foreground">
                        {describeOp(op)}
                      </li>
                    ))}
                  </ul>

                  {/* Rejections are shown, not swallowed: an edit that did not land is something the
                      user needs to know about, or they will assume it did. */}
                  {m.changeset.rejected.length ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {m.changeset.rejected.map((r, ri) => (
                        <li key={ri} className="text-[11px] text-amber-700 dark:text-amber-400">
                          Skipped — {r.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-2.5 flex items-center gap-2">
                    {m.changeset.applied ? (
                      <>
                        <span className="text-xs text-emerald-700 dark:text-emerald-400">Applied.</span>
                        {m.changeset.undo ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => void undoChangeset(i, m.changeset!)}
                          >
                            Undo
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void applyChangeset(i, m.changeset!)}>
                        Apply {m.changeset.ops.length === 1 ? 'change' : 'changes'}
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}

              {m.role === 'assistant' && m.proposal ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium">
                    {m.proposal.blocks.length} block{m.proposal.blocks.length === 1 ? '' : 's'}
                  </p>
                  {/* Per-block actions. Regenerating the whole page to change one hero was the single
                      loudest complaint — each row can be swapped, reworded or dropped on its own, and
                      the server scopes the request so the rest cannot drift while you fix one thing. */}
                  <ol className="mt-2 space-y-1.5">
                    {m.proposal.blocks.map((b, bi) => {
                      const isRefining = refining?.msg === i && refining.block === bi;
                      return (
                        <li key={bi} className="rounded-md border bg-background/60 p-1.5">
                          <div className="group flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={componentThumbnailUrl(b.componentId)}
                              alt=""
                              className="h-8 w-12 shrink-0 rounded border bg-background object-cover"
                              loading="lazy"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {bi + 1}. {b.componentId}
                            </span>
                            {m.proposal!.applied ? null : (
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefining(isRefining ? null : { msg: i, block: bi });
                                    setRefineText('');
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  aria-label={`Change block ${bi + 1}`}
                                  title="Change this block"
                                >
                                  {isRefining ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeBlock(i, bi)}
                                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={`Remove block ${bi + 1}`}
                                  title="Remove"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {isRefining ? (
                            <div className="mt-1.5 flex gap-1.5">
                              <input
                                value={refineText}
                                onChange={(e) => setRefineText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && refineText.trim()) void refineBlock(i, bi, refineText);
                                  if (e.key === 'Escape') setRefining(null);
                                }}
                                placeholder="Something else, shorter copy…"
                                disabled={refineBusy}
                                autoFocus
                                className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 shrink-0 text-xs"
                                disabled={refineBusy || !refineText.trim()}
                                onClick={() => void refineBlock(i, bi, refineText)}
                              >
                                {refineBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Change'}
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
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
            </MessageContent>
          </Message>
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
