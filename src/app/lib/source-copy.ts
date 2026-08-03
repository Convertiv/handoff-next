/**
 * Frame a block of copy the user supplied, so the model treats it as material rather than instruction.
 *
 * Pasting a copy deck into the chat box does not work, and not because the box is small. A user turn is
 * an *instruction*: hand the model twelve paragraphs of marketing copy that way and it reads them as a
 * brief to interpret, summarises them into headlines of its own, and the sentences somebody wrote and
 * signed off do not appear on the page. The URL pull already solved this — it wraps the extraction in
 * "use it as reference, the copy to work from, not a layout to copy" and sends a short label for the
 * transcript. This is the same mechanism with the text coming from a person instead of a fetch.
 *
 * Pure, so the framing is testable without a model. It is also the whole feature: the UI is a textarea
 * and a file read, and neither is where this can go wrong.
 */

/** Plain-text formats read directly in the browser — no dependency, no server round trip. */
export const SOURCE_COPY_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.rtf'] as const;

/**
 * The `accept` attribute for the file picker — extensions **and** MIME types.
 *
 * Extensions alone are what the code shipped with, and they are what the JS checks against, because a
 * browser's reported MIME type for `.md` is unreliable. But `accept` is a different job: it is a hint to
 * the OS file dialog, and an extension-only list is where dialogs get selective about greying files out
 * — Safari on macOS especially. Giving both means the dialog can match on either.
 *
 * Widening `accept` cannot let anything unsafe through: `isReadableTextFile` and `isConvertibleDocument`
 * still gate on extension after the file is chosen, and a dropped file never consults this at all.
 */
export const SOURCE_COPY_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.rtf',
  '.docx',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

/**
 * Roughly a novel chapter.
 *
 * A limit exists because the transcript is replayed on every round of the tool loop — a turn that
 * composes a page ran to thirteen rounds — so pasted copy is paid for once per round, not once. 40k
 * characters is far more than any page's worth of copy and still leaves the loop room to work.
 */
export const SOURCE_COPY_MAX_CHARS = 40_000;

export interface FramedSourceCopy {
  /** What the model receives. */
  content: string;
  /** What the transcript shows in place of it. */
  label: string;
  /** Set when the copy was longer than the cap, so the UI can say so rather than silently truncating. */
  truncated?: boolean;
}

/** Words, near enough for a label. Whitespace-split beats a regex nobody can read. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Whether a file can be read as text in the browser.
 *
 * Extension, not MIME type: browsers report `.md` as `text/markdown`, `text/plain`, or empty depending
 * on the OS, and a `.docx` arrives as a plausible-looking `application/…` that would decode to binary
 * noise and be sent to the model as if it were copy.
 */
export function isReadableTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SOURCE_COPY_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The message shown when a file cannot be read, naming what would work.
 *
 * `.docx` is converted now, so it is not here. `.doc` is: that is the old binary format, mammoth does
 * not read it, and "Word documents work" would be a half-truth that sends someone round a loop.
 */
export function unreadableFileMessage(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  // `.docx` is supported, so reaching here with one means the conversion itself failed — most often a
  // password-protected or corrupt file, which is common enough in a client handoff to name. Saying
  // ".docx files can't be read" while also saying "Word (.docx) works" is the contradiction to avoid.
  if (ext === '.docx') {
    return "That Word document couldn't be read — it may be password-protected or corrupt. Open it and paste the copy in instead.";
  }

  const kind =
    ext === '.doc'
      ? "The older .doc format can't be read"
      : ext === '.pdf'
        ? "PDFs can't be read yet"
        : `${ext || 'That format'} files can't be read`;
  return `${kind} — open it and paste the copy in instead. Word (.docx), text, Markdown and CSV files work.`;
}

/**
 * Wrap supplied copy in the instruction that makes it usable.
 *
 * The instruction is the load-bearing part, and every clause in it is there for a reason:
 *
 * - **Use these words** — otherwise the model paraphrases. Somebody wrote and approved this copy; a
 *   rewrite is a worse outcome than a blank field, because it looks finished.
 * - **Don't invent copy to fill gaps** — a page has more slots than a copy doc has sections, and the
 *   default behaviour is to write plausible filler for the rest. Better to leave a field empty and say
 *   so, which the gap guard already reports.
 * - **This is not a layout** — the same trap the URL importer fell into: heading order in a document is
 *   not a section order on a page.
 */
export function frameSourceCopy(text: string, source?: string): FramedSourceCopy | null {
  const body = text.trim();
  if (!body) return null;

  const truncated = body.length > SOURCE_COPY_MAX_CHARS;
  // Cut at a paragraph break where there is one nearby, so the model is not handed half a sentence.
  const clipped = truncated ? clipAtBoundary(body, SOURCE_COPY_MAX_CHARS) : body;

  const from = source ? ` from ${source}` : '';
  const words = countWords(clipped);

  const content = [
    `Here is copy the user has supplied${from}. Use it as the source material for this page.`,
    '',
    '- Use these words. Put the supplied headings, sentences and phrases into the matching fields',
    '  rather than rewriting them — this copy has been written and approved.',
    '- Do not invent copy to fill fields the document does not cover. Leave them empty and say which',
    '  ones they are, so the user can supply the rest.',
    '- This is source copy, not a layout. Do not treat its heading order as a section order.',
    truncated ? `- It was longer than we can send; the first ~${SOURCE_COPY_MAX_CHARS} characters are below.` : '',
    '',
    '---',
    clipped,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return {
    content,
    label: `Supplied copy${from} (${words.toLocaleString()} words)`,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Cut at the last paragraph or sentence break before the limit, falling back to a hard cut. */
function clipAtBoundary(text: string, limit: number): string {
  const window = text.slice(0, limit);
  for (const boundary of ['\n\n', '\n', '. ']) {
    const at = window.lastIndexOf(boundary);
    // Only honour a boundary in the last fifth, or a stray early newline would throw most of it away.
    if (at > limit * 0.8) return window.slice(0, at).trim();
  }
  return window.trim();
}
