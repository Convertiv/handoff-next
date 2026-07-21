/**
 * MCP App (client) — INLINE PROBE for the embedded component-preview renderer.
 *
 * Deliberately does NOT use a nested iframe (the old approach). It renders
 * everything inline, which is the canonical MCP Apps pattern and sidesteps the
 * whole frame-src CSP class of problem. It is also a diagnostic: it paints a
 * visible status timeline IMMEDIATELY on load — before the ui/initialize
 * handshake — so we can see exactly how far rendering gets in a given host:
 *
 *   ① resource rendered   → the sandbox rendered our HTML at all (no CSP block)
 *   ② handshake           → app.connect() completed the ui/initialize handshake
 *   ③ data received       → the host pushed the tool result to the app
 *
 * If ① shows but ② fails, the blocker is the host-side AppBridge handshake
 * ("Client server capabilities not available"), not our resource/CSP. The error
 * is rendered visibly so it can be read off the screen.
 *
 * Bundled (esbuild → base64) by scripts/build-mcp-apps.mjs into
 * component-preview.bundle.ts and inlined into the ui:// resource HTML.
 */
import { App } from '@modelcontextprotocol/ext-apps';

interface PreviewData {
  componentId?: string;
  previewKey?: string;
  previewUrl?: string;
  imageUrl?: string;
  title?: string;
}

function el(tag: string, props: Record<string, unknown> = {}, style = ''): HTMLElement {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (style) n.setAttribute('style', style);
  return n;
}

function setStep(id: string, text: string, ok: boolean | null): void {
  const n = document.getElementById(id);
  if (!n) return;
  n.textContent = text;
  n.style.color = ok === null ? '#9ca3af' : ok ? '#16a34a' : '#dc2626';
}

/** Paint the probe shell immediately — its mere appearance proves the resource rendered. */
function paintShell(): void {
  const root = document.getElementById('root') ?? document.body.appendChild(el('div', { id: 'root' }));
  root.innerHTML = '';
  root.setAttribute('style', 'font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;line-height:1.5;color:#111');

  root.appendChild(el('div', { textContent: 'Handoff inline probe' }, 'font-weight:600;font-size:15px;margin-bottom:4px'));
  root.appendChild(
    el('div', { textContent: 'Inline rendering test — no nested iframe.' }, 'font-size:12px;color:#6b7280;margin-bottom:12px')
  );

  const steps = el('div', {}, 'display:flex;flex-direction:column;gap:4px;font-size:13px;margin-bottom:14px');
  steps.appendChild(el('div', { id: 'hp-s1', textContent: '① resource rendered ✓' }, 'color:#16a34a'));
  steps.appendChild(el('div', { id: 'hp-s2', textContent: '② handshake — connecting…' }, 'color:#9ca3af'));
  steps.appendChild(el('div', { id: 'hp-s3', textContent: '③ data — waiting…' }, 'color:#9ca3af'));
  root.appendChild(steps);

  // Inline SVG swatch — proves inline graphics render with zero CSP/network.
  const swatch = el('div', {}, 'display:flex;align-items:center;gap:8px;margin-bottom:14px');
  swatch.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="28" height="28" rx="6" fill="#2563eb"/></svg>' +
    '<span style="font-size:12px;color:#6b7280">inline SVG (no network)</span>';
  root.appendChild(swatch);

  root.appendChild(el('div', { id: 'hp-payload' }));
}

/** Render the tool-result payload inline: title, a cross-origin <img> (img-src test), and raw data. */
function renderPayload(data: PreviewData): void {
  const host = document.getElementById('hp-payload');
  if (!host) return;
  host.innerHTML = '';

  if (data.title) {
    host.appendChild(el('div', { textContent: data.title }, 'font-weight:600;font-size:14px;margin-bottom:8px'));
  }

  // Cross-origin image (registry origin) — tests CSP img-src / resourceDomains.
  if (data.imageUrl) {
    const img = el('img') as HTMLImageElement;
    img.src = data.imageUrl;
    img.alt = data.title ?? 'preview';
    img.setAttribute(
      'style',
      'max-width:120px;max-height:120px;border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff'
    );
    img.addEventListener('error', () => {
      img.replaceWith(el('div', { textContent: '⚠ cross-origin image blocked (img-src)' }, 'font-size:12px;color:#dc2626'));
    });
    const wrap = el('div', {}, 'margin-bottom:10px');
    wrap.appendChild(el('div', { textContent: 'cross-origin image (img-src test):' }, 'font-size:12px;color:#6b7280;margin-bottom:4px'));
    wrap.appendChild(img);
    host.appendChild(wrap);
  }

  const pre = el(
    'pre',
    { textContent: JSON.stringify(data, null, 2) },
    'font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px;overflow:auto;margin:0'
  );
  host.appendChild(pre);
}

/** Pull structuredContent out of whatever shape the host delivers the tool result in. */
function extractData(params: unknown): PreviewData | null {
  const p = params as { result?: { structuredContent?: unknown }; structuredContent?: unknown };
  const sc = p?.result?.structuredContent ?? p?.structuredContent;
  return sc && typeof sc === 'object' ? (sc as PreviewData) : null;
}

async function main(): Promise<void> {
  paintShell(); // ① — happens regardless of handshake

  const app = new App({ name: 'handoff-component-preview', version: '1.0.0' });
  app.addEventListener('toolresult', (params) => {
    const data = extractData(params);
    setStep('hp-s3', data ? '③ data received ✓' : '③ data — received, but no structuredContent', !!data);
    if (data) renderPayload(data);
  });

  try {
    await app.connect();
    setStep('hp-s2', '② handshake ✓', true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStep('hp-s2', `② handshake FAILED: ${msg}`, false);
  }
}

void main().catch((e) => {
  // Last-resort visible error if even paintShell/main threw.
  const msg = e instanceof Error ? e.message : String(e);
  const root = document.getElementById('root') ?? document.body;
  root.appendChild(el('div', { textContent: `probe crashed: ${msg}` }, 'color:#dc2626;font-size:13px;padding:12px'));
});
