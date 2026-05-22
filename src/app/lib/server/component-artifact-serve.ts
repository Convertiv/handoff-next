import path from 'node:path';

function isUnset(v: string | undefined): boolean {
  return !v || v.startsWith('%HANDOFF_');
}

/**
 * Optional on-disk `public/api/component` root for local dev / materialized deploys.
 * Returns null on serverless when env is unset — callers should use Postgres only.
 *
 * Kept separate from `static-provider` to avoid pulling the full data layer into App Routes
 * (Turbopack NFT traces dynamic fs/path usage across the import graph).
 */
export function getComponentArtifactDiskDir(): string | null {
  const appRoot = process.env.HANDOFF_APP_ROOT?.trim();
  if (!isUnset(appRoot)) {
    return path.join(path.resolve(appRoot!), 'public', 'api', 'component');
  }
  const working = process.env.HANDOFF_WORKING_PATH?.trim();
  if (!isUnset(working)) {
    return path.join(path.resolve(working!), 'public', 'api', 'component');
  }
  return null;
}

/** Resolve `filename` under `baseDir`; returns null if the result escapes the base. */
export function resolveComponentArtifactDiskPath(baseDir: string, filename: string): string | null {
  const absBase = path.resolve(baseDir);
  const abs = path.resolve(absBase, filename);
  if (abs !== absBase && !abs.startsWith(`${absBase}${path.sep}`)) {
    return null;
  }
  return abs;
}

export function contentTypeForComponentArtifact(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

export function isBinaryArtifactFilename(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp';
}
