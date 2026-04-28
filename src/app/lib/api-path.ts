/** Base path for Handoff (e.g. `/docs`) — matches `HANDOFF_APP_BASE_PATH` baked into the client bundle. */
export function handoffBasePath(): string {
  const raw = process.env.HANDOFF_APP_BASE_PATH ?? '';
  if (!raw || raw.startsWith('%HANDOFF_')) return '';
  return raw.replace(/\/+$/, '');
}

export function handoffApiUrl(path: string): string {
  const base = handoffBasePath();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
