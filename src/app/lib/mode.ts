export type HandoffMode = 'static' | 'dynamic';

function normalizeMode(raw: string | undefined): HandoffMode {
  if (raw === 'dynamic') return 'dynamic';
  return 'static';
}

/**
 * Build / runtime mode for Handoff. `static` = full static export (default).
 * `dynamic` = full Next.js server (DB, auth, route handlers).
 */
export function getMode(): HandoffMode {
  const raw = typeof process !== 'undefined' ? process.env.HANDOFF_MODE : undefined;
  if (!raw || raw.startsWith('%HANDOFF_')) {
    return 'static';
  }
  return normalizeMode(raw);
}

export function isDynamic(): boolean {
  return getMode() === 'dynamic';
}
