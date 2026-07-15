/**
 * MCP App (client) for the embedded component-preview renderer (Track 6.2).
 *
 * Runs inside the host's sandboxed iframe. Uses the ext-apps `App` helper to do
 * the `ui/initialize` handshake, then receives the tool result
 * (`handoff_preview_component`) via the `toolresult` event and renders the
 * component's real preview by pointing an inner iframe at the registry's built
 * preview HTML (`/api/component/{id}-{preview}.html`) — reusing the §14 render.
 *
 * This file is bundled (esbuild → base64) by scripts/build-mcp-apps.mjs into
 * component-preview.bundle.ts and inlined into the ui:// resource HTML.
 */
import { App } from '@modelcontextprotocol/ext-apps';

interface PreviewData {
  componentId?: string;
  previewKey?: string;
  previewUrl?: string;
  title?: string;
}

const WIDTHS: ReadonlyArray<[label: string, width: string]> = [
  ['Desktop', '100%'],
  ['Tablet', '820px'],
  ['Mobile', '390px'],
];

function setWidth(width: string): void {
  const wrap = document.getElementById('hp-wrap');
  if (wrap) wrap.style.width = width;
}

function buildToolbar(bar: HTMLElement): void {
  WIDTHS.forEach(([label, width], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (i === 0) b.classList.add('active');
    b.addEventListener('click', () => {
      setWidth(width);
      Array.from(bar.children).forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
    });
    bar.appendChild(b);
  });
}

function showPreview(data: PreviewData): void {
  const frame = document.getElementById('hp-frame') as HTMLIFrameElement | null;
  const empty = document.getElementById('hp-empty');
  const title = document.getElementById('hp-title');
  if (title && data.title) title.textContent = data.title;
  if (data.previewUrl && frame) {
    frame.src = data.previewUrl;
    frame.style.display = 'block';
    if (empty) empty.style.display = 'none';
  } else if (empty) {
    empty.textContent = 'No preview available for this component.';
  }
}

/** Pull structuredContent out of whatever shape the host delivers the tool result in. */
function extractData(params: unknown): PreviewData | null {
  const p = params as { result?: { structuredContent?: unknown }; structuredContent?: unknown };
  const sc = p?.result?.structuredContent ?? p?.structuredContent;
  return sc && typeof sc === 'object' ? (sc as PreviewData) : null;
}

async function main(): Promise<void> {
  const bar = document.getElementById('hp-bar');
  if (bar) buildToolbar(bar);

  const app = new App({ name: 'handoff-component-preview', version: '1.0.0' });
  app.addEventListener('toolresult', (params) => {
    const data = extractData(params);
    if (data) showPreview(data);
  });
  await app.connect();
}

void main().catch(() => {
  const empty = document.getElementById('hp-empty');
  if (empty) empty.textContent = 'Preview app failed to initialize.';
});
