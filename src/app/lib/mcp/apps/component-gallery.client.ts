/**
 * MCP App (client) — Component gallery / picker (Track 6.2, component flow v1).
 *
 * Inline metadata-rich card grid fed by the `handoff_browse_components` tool
 * result. Pure inline (no thumbnails yet — no production-viable component-image
 * source exists; cards carry an optional imageUrl slot so thumbnails drop in
 * later without rework). Search/filter is client-side over the delivered list.
 *
 * Interactions (both degrade gracefully, since Claude's app→host outbound
 * support is still being confirmed):
 *   - Click a card  → select it → push the choice back via updateModelContext
 *   - "Open ↗"      → openLink to the component's live detail page in Handoff
 *
 * Bundled (esbuild → base64) by scripts/build-mcp-apps.mjs.
 */
import { App } from '@modelcontextprotocol/ext-apps';

interface ComponentCard {
  id: string;
  title?: string;
  group?: string;
  type?: string;
  tags?: string[];
  detailUrl?: string;
  imageUrl?: string;
}
interface GalleryData { components?: ComponentCard[] }

let appRef: App | null = null;
let allComponents: ComponentCard[] = [];

function el(tag: string, props: Partial<HTMLElement> = {}, style = ''): HTMLElement {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (style) n.setAttribute('style', style);
  return n;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => window.setTimeout(() => rej(new Error(`no response in ${ms}ms`)), ms)),
  ]);
}

function setStatus(text: string, ok: boolean | null): void {
  const s = document.getElementById('cg-status');
  if (!s) return;
  s.textContent = text;
  s.style.color = ok === null ? '#9ca3af' : ok ? '#16a34a' : '#dc2626';
}

function showSelected(c: ComponentCard): void {
  const panel = document.getElementById('cg-selected');
  if (!panel) return;
  panel.innerHTML = '';
  panel.appendChild(el('div', { textContent: 'Selected component' }, 'font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280'));
  panel.appendChild(el('div', { textContent: `${c.title ?? c.id}  ·  ${c.id}` }, 'font-size:13px;font-weight:600;color:#111'));
  panel.appendChild(el('div', { id: 'cg-status', textContent: 'notifying assistant…' }, 'font-size:11px;color:#9ca3af;margin-top:3px'));
}

async function selectComponent(c: ComponentCard): Promise<void> {
  showSelected(c);
  try {
    if (!appRef) throw new Error('app not connected');
    await withTimeout(
      appRef.updateModelContext({
        content: [{ type: 'text', text: `User selected the "${c.title ?? c.id}" component (id: ${c.id}) from the Handoff gallery.` }],
        structuredContent: { selectedComponent: { id: c.id, title: c.title, group: c.group } },
      }),
      3500
    );
    setStatus('✓ shared with the assistant', true);
  } catch (e) {
    setStatus(`assistant not notified (${e instanceof Error ? e.message : 'error'}) — component id: ${c.id}`, false);
  }
}

async function openComponent(c: ComponentCard): Promise<void> {
  if (!c.detailUrl) return;
  try {
    if (!appRef) throw new Error('app not connected');
    await withTimeout(appRef.openLink({ url: c.detailUrl }), 3500);
  } catch {
    // openLink unsupported — surface the URL so it can be opened manually.
    showSelected(c);
    setStatus(`open manually: ${c.detailUrl}`, false);
  }
}

function badge(text: string): HTMLElement {
  return el('span', { textContent: text }, 'font-size:10px;padding:1px 6px;border-radius:999px;background:#eef2ff;color:#4338ca');
}

function card(c: ComponentCard): HTMLElement {
  const wrap = el('div', {}, 'display:flex;flex-direction:column;gap:6px;border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fff;width:150px');

  // Thumbnail slot — image when available, else a neutral placeholder.
  if (c.imageUrl) {
    const img = el('img') as HTMLImageElement;
    img.src = c.imageUrl;
    img.alt = c.title ?? c.id;
    img.setAttribute('style', 'width:100%;height:72px;object-fit:contain;border:1px solid #f3f4f6;border-radius:6px;background:#fafafa');
    wrap.appendChild(img);
  } else {
    wrap.appendChild(el('div', { textContent: (c.title ?? c.id).slice(0, 2).toUpperCase() },
      'width:100%;height:72px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:#f3f4f6;color:#9ca3af;font-weight:700;font-size:18px'));
  }

  wrap.appendChild(el('div', { textContent: c.title ?? c.id }, 'font-size:12px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
  const meta = el('div', {}, 'display:flex;flex-wrap:wrap;gap:4px');
  if (c.group) meta.appendChild(badge(c.group));
  if (c.type) meta.appendChild(badge(c.type));
  wrap.appendChild(meta);

  const actions = el('div', {}, 'display:flex;gap:6px;margin-top:2px');
  const pick = el('button', { textContent: 'Select' }, 'flex:1;font:inherit;font-size:11px;padding:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer') as HTMLButtonElement;
  pick.type = 'button';
  pick.addEventListener('click', () => void selectComponent(c));
  actions.appendChild(pick);
  if (c.detailUrl) {
    const open = el('button', { textContent: 'Open ↗' }, 'font:inherit;font-size:11px;padding:4px 8px;border:1px solid #d1d5db;background:#fff;color:#111;border-radius:6px;cursor:pointer') as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => void openComponent(c));
    actions.appendChild(open);
  }
  wrap.appendChild(actions);
  return wrap;
}

function renderGrid(list: ComponentCard[]): void {
  const grid = document.getElementById('cg-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list.length) {
    grid.appendChild(el('div', { textContent: 'No components match.' }, 'font-size:13px;color:#6b7280'));
    return;
  }
  for (const c of list) grid.appendChild(card(c));
}

function applyFilter(): void {
  const q = (document.getElementById('cg-search') as HTMLInputElement | null)?.value.trim().toLowerCase() ?? '';
  const list = !q
    ? allComponents
    : allComponents.filter((c) =>
        [c.id, c.title, c.group, c.type, (c.tags ?? []).join(' ')].join(' ').toLowerCase().includes(q)
      );
  const count = document.getElementById('cg-count');
  if (count) count.textContent = `${list.length} of ${allComponents.length}`;
  renderGrid(list);
}

function paintShell(): void {
  const root = document.getElementById('root') ?? document.body.appendChild(el('div', { id: 'root' }));
  root.innerHTML = '';
  root.setAttribute('style', 'font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;color:#111;max-height:72vh;overflow:auto');
  root.appendChild(el('div', { textContent: 'Components' }, 'font-weight:600;font-size:15px;margin-bottom:2px'));
  root.appendChild(el('div', { textContent: 'Search, then Select to hand one to the assistant, or Open to view it in Handoff.' }, 'font-size:12px;color:#6b7280;margin-bottom:10px'));

  const bar = el('div', {}, 'display:flex;align-items:center;gap:8px;margin-bottom:12px');
  const search = el('input', { id: 'cg-search', placeholder: 'Search components…' }, 'flex:1;font:inherit;font-size:13px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px') as HTMLInputElement;
  search.addEventListener('input', applyFilter);
  bar.appendChild(search);
  bar.appendChild(el('span', { id: 'cg-count', textContent: '' }, 'font-size:11px;color:#9ca3af;flex-shrink:0'));
  root.appendChild(bar);

  root.appendChild(el('div', { id: 'cg-grid', textContent: 'Loading components…' }, 'display:flex;flex-wrap:wrap;gap:10px'));
  root.appendChild(el('div', { id: 'cg-selected' }, 'position:sticky;bottom:0;background:#f9fafb;border-top:1px solid #e5e7eb;margin:12px -16px -16px;padding:10px 16px;min-height:18px'));
  root.appendChild(el('div', { id: 'cg-caps', textContent: '' }, 'font-size:10px;color:#c0c4cc;padding-top:6px'));
}

function extractData(params: unknown): GalleryData | null {
  const p = params as { result?: { structuredContent?: unknown }; structuredContent?: unknown };
  const sc = p?.result?.structuredContent ?? p?.structuredContent;
  return sc && typeof sc === 'object' ? (sc as GalleryData) : null;
}

async function main(): Promise<void> {
  paintShell();
  const app = new App({ name: 'handoff-component-gallery', version: '1.0.0' });
  appRef = app;
  app.addEventListener('toolresult', (params) => {
    const data = extractData(params);
    if (data?.components) {
      allComponents = data.components;
      applyFilter();
    }
  });
  try {
    await app.connect();
    const caps = document.getElementById('cg-caps');
    try {
      const hc = app.getHostCapabilities?.();
      if (caps) caps.textContent = `host capabilities: ${hc ? JSON.stringify(hc) : '(none reported)'}`;
    } catch {
      /* non-fatal */
    }
  } catch (e) {
    const grid = document.getElementById('cg-grid');
    if (grid) grid.textContent = `Failed to connect: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void main().catch((e) => {
  const root = document.getElementById('root') ?? document.body;
  root.appendChild(el('div', { textContent: `gallery app crashed: ${e instanceof Error ? e.message : String(e)}` }, 'color:#dc2626;font-size:13px;padding:12px'));
});
