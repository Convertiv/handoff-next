/**
 * Canonical Handoff API scope vocabulary — shared by the CLI device flow and the
 * MCP OAuth connector so both issue/advertise the same scopes from one place.
 */
export const OAUTH_SCOPES = [
  'sync:read',
  'sync:write',
  'reference:read',
  'components:read',
  'components:write',
  'design:read',
  'design:write',
  'generate:component',
  'figma:sync',
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export function scopesForRole(role: string | undefined): string {
  if (role === 'admin') {
    return OAUTH_SCOPES.join(' ');
  }
  return (['sync:read', 'reference:read', 'components:read', 'design:read', 'design:write'] as const).join(' ');
}

/** Intersect a requested scope string against what the user's role actually grants. */
export function narrowScopesToRole(requested: string | undefined, role: string | undefined): string {
  const allowed = new Set(scopesForRole(role).split(/\s+/).filter(Boolean));
  if (!requested?.trim()) return [...allowed].join(' ');
  const wanted = requested.split(/\s+/).filter(Boolean);
  const granted = wanted.filter((s) => allowed.has(s));
  return (granted.length ? granted : [...allowed]).join(' ');
}
