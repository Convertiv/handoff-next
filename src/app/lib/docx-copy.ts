/**
 * Turn a Word document into copy the model can place.
 *
 * The conversion that matters is not docx→text, it is docx→**structure**. `frameSourceCopy` tells the
 * model to put the supplied headings into matching fields, and a flat text dump destroys exactly the
 * signal that instruction depends on — a heading and a paragraph come out looking identical, so the
 * model has to guess which sentences are headlines and guessing is what we have spent the day removing.
 *
 * So: mammoth converts the docx to HTML (it knows about `w:pStyle`, numbering references and table
 * traversal, none of which is worth reimplementing), and this reduces that HTML to markdown-ish plain
 * text where `#` still means heading. Everything here is pure and works on a string, which is the only
 * part that can be got wrong in an interesting way.
 *
 * Word only. `.doc` is the old binary format and mammoth does not read it; that stays a paste.
 */

/** Extensions this module can convert. `.doc` is deliberately absent — see above. */
export const DOCX_EXTENSIONS = ['.docx'] as const;

export function isConvertibleDocument(name: string): boolean {
  return DOCX_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/** The handful of entities Word documents actually produce. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last, or `&amp;lt;` would decode twice and turn text into a tag.
    .replace(/&amp;/g, '&');
}

/** Strip tags from a fragment and normalise its whitespace, keeping the words. */
function inlineText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
  ).trim();
}

/**
 * Reduce mammoth's HTML to structured plain text.
 *
 * A single pass over the tags, keeping a list-type stack — not paired-tag regexes. `<ol><li>…</li></ol>`
 * defeats a non-greedy paired match the moment lists nest, and a nested list is how anybody writes
 * tiers or sub-points in a copy deck.
 *
 * Ordered lists keep their numbers, because a numbered list in a copy deck is usually a sequence the
 * page has to preserve — steps, tiers, a ranked set. Tables become pipe rows: agencies write copy decks
 * as two-column "Section | Copy" tables more often than anyone would like, and flattening one into
 * prose loses which cell paired with which.
 */
export function htmlToSourceCopy(html: string): string {
  if (!html?.trim()) return '';

  const blocks: string[] = [];
  /** Nesting stack of list types, so an `<ol>` inside a `<ul>` still numbers. */
  const lists: { ordered: boolean; count: number }[] = [];
  let current: { prefix: string; text: string } | null = null;
  /**
   * Inside a table cell.
   *
   * mammoth wraps cell content in a paragraph — `<td><p>Section</p></td>` — so without this the inner
   * `<p>` opens a fresh block with no prefix and the cell's `| ` is lost. The first fixture run came
   * back with a two-column copy deck flattened into four unrelated paragraphs, which is exactly the
   * pairing the pipe rows exist to keep.
   */
  let inCell = false;
  /** Cells of the row being read, emitted as one line when `</tr>` closes. */
  let row: string[] = [];
  /**
   * Rows of the table being read, emitted together as one markdown table.
   *
   * Emitting each row as its own paragraph was wrong in a way that cost real work. A three-column
   * rewrite brief — Section / Old Copy / New Copy — came out as:
   *
   *     | Section | Old Copy | New Copy |
   *
   *     | Hero | Legacy headline | Partner with 8x8 |
   *
   * The header is present and indistinguishable from data, and blank lines between rows mean it is not
   * a table at all, just pipe-ish paragraphs. So nothing said which column was the copy to use, and the
   * model took the old one. A real markdown table — contiguous lines, separator under the header — is a
   * format models read reliably, and it makes the header a header.
   */
  let tableRows: string[][] = [];

  const flush = () => {
    const text = current ? normalizeSpace(current.text) : '';
    // A cell joins its row rather than becoming its own block; the row is emitted by `flushRow`.
    if (current && text) {
      if (current.prefix === '| ') row.push(text);
      else blocks.push(`${current.prefix}${text}`);
    }
    current = null;
  };

  /**
   * End a table row.
   *
   * Row boundaries have to be honoured here rather than inferred afterwards. A post-pass that merged
   * every consecutive cell produced `| Section | Copy | Hero | Talk to every building` — two rows of a
   * two-column copy deck run together, which destroys the pairing the pipes were added to preserve.
   */
  const flushRow = () => {
    if (row.length) tableRows.push(row);
    row = [];
  };

  /**
   * End a table, as one markdown block.
   *
   * The first row is treated as the header. A table's first row is its header the overwhelming majority
   * of the time, and markdown requires one — a brief whose first row is data loses nothing but a
   * separator line, where a header treated as data loses the meaning of every column beneath it.
   */
  const flushTable = () => {
    if (!tableRows.length) return;
    const width = Math.max(...tableRows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
    const [header, ...body] = tableRows;
    const lines = [
      `| ${pad(header!).join(' | ')} |`,
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...body.map((r) => `| ${pad(r).join(' | ')} |`),
    ];
    blocks.push(lines.join('\n'));
    tableRows = [];
  };

  const prefixFor = (tag: string): string => {
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} `;
    if (tag === 'td' || tag === 'th') return '| ';
    // A paragraph inside a cell is the cell.
    if (tag === 'p' && inCell) return '| ';
    if (tag !== 'li') return '';
    const list = lists[lists.length - 1];
    if (!list) return '- ';
    if (!list.ordered) return `${'  '.repeat(lists.length - 1)}- `;
    list.count += 1;
    return `${'  '.repeat(lists.length - 1)}${list.count}. `;
  };

  const BLOCKS = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  // Alternates between tags and the text between them, so nothing is dropped by a tag we do not know.
  const tokens = /<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(html)) !== null) {
    const [raw, name, text] = token;

    if (text !== undefined) {
      if (current) current.text += text;
      continue;
    }

    const tag = (name ?? '').toLowerCase();
    const closing = raw.startsWith('</');

    if (tag === 'table') {
      flush();
      flushRow();
      flushTable();
      continue;
    }
    if (tag === 'tr') {
      flush();
      flushRow();
      continue;
    }
    if (tag === 'ol' || tag === 'ul') {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: tag === 'ol', count: 0 });
      continue;
    }
    if (tag === 'br') {
      if (current) current.text += ' ';
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      flush();
      inCell = !closing;
      if (!closing) current = { prefix: '| ', text: '' };
      continue;
    }
    if (BLOCKS.has(tag)) {
      flush();
      // The prefix is computed on open, so an ordered counter increments once per item rather than once
      // per tag inside it.
      if (!closing) current = { prefix: prefixFor(tag), text: '' };
      continue;
    }
    // Any other tag — `<strong>`, `<em>`, `<a>`, `<img>`, Word's stray divs — contributes no structure
    // and its text is already being collected by the block it sits inside.
  }
  flush();
  flushRow();
  flushTable();

  // Nothing matched: a document of bare text runs, or HTML shaped in a way this misses. Fall back to a
  // plain strip rather than returning nothing — losing the structure is a degraded result, losing the
  // copy is a broken one.
  if (!blocks.length) return inlineText(html);

  return blocks.join('\n\n');
}

/** Collapse whitespace and decode entities, once, at the point a block is emitted. */
function normalizeSpace(text: string): string {
  return decodeEntities(text.replace(/\s+/g, ' ')).trim();
}

/**
 * Convert a `.docx` file to source copy, in the browser.
 *
 * mammoth is imported dynamically so its ~2MB does not sit in the playground's initial bundle for
 * everyone who never opens a Word document. Its `browser` package field swaps the unzip implementation,
 * so the bundler resolves the right one with no configuration.
 *
 * Takes an ArrayBuffer rather than a File so it stays testable in Node against a fixture.
 */
export async function docxToSourceCopy(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');

  /**
   * Both keys, deliberately.
   *
   * mammoth ships two unzip implementations and its `browser` package field swaps between them. The
   * browser one reads `arrayBuffer`; the Node one reads `path` or `buffer` and throws "Could not find
   * file in options" on an `arrayBuffer` it does not recognise. Passing both means each environment
   * finds the key it knows — the browser at runtime, Node in the fixture test, which is the only place
   * this conversion is actually verified.
   */
  const input: { arrayBuffer: ArrayBuffer; buffer?: Uint8Array } = { arrayBuffer };
  if (typeof Buffer !== 'undefined') input.buffer = Buffer.from(arrayBuffer);

  // `convertToHtml`, not `extractRawText`: raw text is exactly the flat dump that loses the heading
  // structure this whole path exists to preserve.
  const { value } = await (mammoth as unknown as {
    convertToHtml: (input: unknown) => Promise<{ value: string }>;
  }).convertToHtml(input);
  return htmlToSourceCopy(value);
}
