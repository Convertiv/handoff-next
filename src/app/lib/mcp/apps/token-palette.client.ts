/**
 * MCP App (client) — Token / palette picker (Track 6.2, second app).
 *
 * Pure inline: colors, type specimens, and the spacing scale are all CSS — no
 * network, no images, no nested iframe. Fed by the `handoff_browse_tokens` tool
 * result (foundation tokens as structuredContent). Clicking a token pushes the
 * choice back to the model via the app→host bridge (updateModelContext), which
 * also validates the outbound interactive loop that the "take action" apps
 * (page builder → write tools) will rely on.
 *
 * Bundled (esbuild → base64) by scripts/build-mcp-apps.mjs.
 */
import { App } from '@modelcontextprotocol/ext-apps';

interface ColorToken { name?: string; value?: string; group?: string; sass?: string; reference?: string; machineName?: string }
interface TypeToken {
  name?: string; reference?: string; machineName?: string;
  values?: { fontFamily?: string; fontSize?: string | number; fontWeight?: string | number; lineHeightPx?: string | number; letterSpacing?: string | number };
}
interface DimToken { name?: string; value?: string; cssVariable?: string; reference?: string }
interface TokenData { colors?: ColorToken[]; typography?: TypeToken[]; spacing?: DimToken[]; borderRadius?: DimToken[] }

let appRef: App | null = null;

function el(tag: string, props: Partial<HTMLElement> = {}, style = ''): HTMLElement {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (style) n.setAttribute('style', style);
  return n;
}

function toast(msg: string, ok = true): void {
  const t = document.getElementById('tp-toast');
  if (!t) return;
  t.textContent = msg;
  t.style.color = ok ? '#16a34a' : '#dc2626';
  t.style.opacity = '1';
  window.setTimeout(() => { t.style.opacity = '0.55'; }, 2200);
}

/** Push a token choice back to the conversation. Returns false if the bridge call is unavailable. */
async function pickToken(kind: string, ref: string, detail: Record<string, unknown>): Promise<void> {
  const label = `${kind} token \`${ref}\``;
  try {
    if (!appRef) throw new Error('app not connected');
    await appRef.updateModelContext({
      content: [{ type: 'text', text: `User selected ${label} from the Handoff palette.` }],
      structuredContent: { selectedToken: { kind, reference: ref, ...detail } },
    });
    toast(`✓ shared with the assistant: ${ref}`, true);
  } catch {
    // Outbound bridge unavailable — still useful: surface the reference to copy.
    toast(`copy this reference: ${ref}`, false);
  }
}

function section(title: string): HTMLElement {
  const wrap = el('div', {}, 'margin-bottom:20px');
  wrap.appendChild(el('div', { textContent: title }, 'font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:8px'));
  return wrap;
}

function renderColors(colors: ColorToken[], host: HTMLElement): void {
  const groups = new Map<string, ColorToken[]>();
  for (const c of colors) {
    const g = c.group || 'colors';
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(c);
  }
  for (const [group, items] of groups) {
    const sec = section(group);
    const grid = el('div', {}, 'display:flex;flex-wrap:wrap;gap:8px');
    for (const c of items) {
      const ref = c.sass || c.reference || c.machineName || c.name || '';
      const card = el('button', {}, 'display:flex;flex-direction:column;gap:4px;border:1px solid #e5e7eb;border-radius:8px;padding:6px;background:#fff;cursor:pointer;width:96px;text-align:left') as HTMLButtonElement;
      card.type = 'button';
      card.appendChild(el('div', {}, `height:44px;border-radius:5px;border:1px solid rgba(0,0,0,.08);background:${c.value ?? '#fff'}`));
      card.appendChild(el('div', { textContent: c.name ?? ref }, 'font-size:11px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
      card.appendChild(el('div', { textContent: c.value ?? '' }, 'font-size:10px;color:#9ca3af;font-family:ui-monospace,monospace'));
      card.addEventListener('click', () => void pickToken('color', ref, { name: c.name, value: c.value, group }));
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    host.appendChild(sec);
  }
}

function renderType(items: TypeToken[], host: HTMLElement): void {
  const sec = section('Typography');
  for (const t of items) {
    const ref = t.reference || t.machineName || t.name || '';
    const v = t.values ?? {};
    const row = el('button', {}, 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;width:100%;border:0;border-bottom:1px solid #f3f4f6;padding:8px 2px;background:transparent;cursor:pointer;text-align:left') as HTMLButtonElement;
    row.type = 'button';
    const specimenStyle = `font-family:${v.fontFamily ?? 'inherit'};font-size:${typeof v.fontSize === 'number' ? v.fontSize + 'px' : v.fontSize ?? '16px'};font-weight:${v.fontWeight ?? 400};color:#111;line-height:1.2`;
    row.appendChild(el('span', { textContent: t.name ?? ref }, specimenStyle));
    row.appendChild(el('span', { textContent: ref }, 'font-size:10px;color:#9ca3af;font-family:ui-monospace,monospace;flex-shrink:0'));
    row.addEventListener('click', () => void pickToken('typography', ref, { name: t.name, values: v }));
    sec.appendChild(row);
  }
  host.appendChild(sec);
}

function renderDims(title: string, items: DimToken[], host: HTMLElement): void {
  const sec = section(title);
  for (const d of items) {
    const ref = d.cssVariable || d.reference || d.name || '';
    const px = parseFloat(String(d.value ?? '0')) || 0;
    const row = el('button', {}, 'display:flex;align-items:center;gap:10px;width:100%;border:0;padding:5px 2px;background:transparent;cursor:pointer;text-align:left') as HTMLButtonElement;
    row.type = 'button';
    row.appendChild(el('span', { textContent: d.name ?? ref }, 'font-size:11px;width:88px;flex-shrink:0;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    row.appendChild(el('span', {}, `height:12px;border-radius:3px;background:#2563eb;width:${Math.min(px, 240)}px;flex-shrink:0`));
    row.appendChild(el('span', { textContent: d.value ?? '' }, 'font-size:10px;color:#9ca3af;font-family:ui-monospace,monospace'));
    row.addEventListener('click', () => void pickToken(title.toLowerCase(), ref, { name: d.name, value: d.value }));
    sec.appendChild(row);
  }
  host.appendChild(sec);
}

function render(data: TokenData): void {
  const host = document.getElementById('tp-body');
  if (!host) return;
  host.innerHTML = '';
  const has = (a?: unknown[]) => Array.isArray(a) && a.length > 0;
  if (has(data.colors)) renderColors(data.colors!, host);
  if (has(data.typography)) renderType(data.typography!, host);
  if (has(data.spacing)) renderDims('Spacing', data.spacing!, host);
  if (has(data.borderRadius)) renderDims('Radius', data.borderRadius!, host);
  if (!has(data.colors) && !has(data.typography) && !has(data.spacing)) {
    host.appendChild(el('div', { textContent: 'No foundation tokens found for this design system.' }, 'font-size:13px;color:#6b7280'));
  }
}

function paintShell(): void {
  const root = document.getElementById('root') ?? document.body.appendChild(el('div', { id: 'root' }));
  root.innerHTML = '';
  root.setAttribute('style', 'font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;color:#111;max-height:70vh;overflow:auto');
  root.appendChild(el('div', { textContent: 'Design tokens' }, 'font-weight:600;font-size:15px;margin-bottom:2px'));
  root.appendChild(el('div', { textContent: 'Click any token to hand it to the assistant.' }, 'font-size:12px;color:#6b7280;margin-bottom:14px'));
  root.appendChild(el('div', { id: 'tp-body', textContent: 'Loading tokens…' }));
  root.appendChild(el('div', { id: 'tp-toast', textContent: '' }, 'position:sticky;bottom:0;font-size:12px;padding-top:10px;transition:opacity .3s'));
}

function extractData(params: unknown): TokenData | null {
  const p = params as { result?: { structuredContent?: unknown }; structuredContent?: unknown };
  const sc = p?.result?.structuredContent ?? p?.structuredContent;
  return sc && typeof sc === 'object' ? (sc as TokenData) : null;
}

async function main(): Promise<void> {
  paintShell();
  const app = new App({ name: 'handoff-token-palette', version: '1.0.0' });
  appRef = app;
  app.addEventListener('toolresult', (params) => {
    const data = extractData(params);
    if (data) render(data);
  });
  try {
    await app.connect();
  } catch (e) {
    const body = document.getElementById('tp-body');
    if (body) body.textContent = `Failed to connect: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void main().catch((e) => {
  const root = document.getElementById('root') ?? document.body;
  root.appendChild(el('div', { textContent: `palette app crashed: ${e instanceof Error ? e.message : String(e)}` }, 'color:#dc2626;font-size:13px;padding:12px'));
});
