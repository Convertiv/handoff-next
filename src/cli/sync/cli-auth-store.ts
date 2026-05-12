import fs from 'fs-extra';
import path from 'path';

export type CliAuthFile = {
  remoteUrl: string;
  accessToken: string;
  /** Epoch ms when access token should be refreshed / re-login */
  expiresAtMs: number;
};

function normalizeRemoteUrl(u: string): string {
  return u.replace(/\/+$/, '');
}

export function cliAuthFilePath(workingPath: string): string {
  return path.join(workingPath, '.handoff', 'cli-auth.json');
}

export async function readCliAuth(workingPath: string): Promise<CliAuthFile | null> {
  const fp = cliAuthFilePath(workingPath);
  if (!(await fs.pathExists(fp))) return null;
  try {
    const j = (await fs.readJson(fp)) as CliAuthFile;
    if (!j?.accessToken || !j?.remoteUrl) return null;
    return j;
  } catch {
    return null;
  }
}

export async function writeCliAuth(workingPath: string, data: CliAuthFile): Promise<void> {
  const fp = cliAuthFilePath(workingPath);
  await fs.ensureDir(path.dirname(fp));
  await fs.writeJson(fp, { ...data, remoteUrl: normalizeRemoteUrl(data.remoteUrl) }, { spaces: 2 });
}

export async function clearCliAuth(workingPath: string): Promise<void> {
  const fp = cliAuthFilePath(workingPath);
  if (await fs.pathExists(fp)) await fs.remove(fp);
}

export function cliAuthMatchesRemote(auth: CliAuthFile | null, remoteUrl: string): boolean {
  if (!auth) return false;
  return normalizeRemoteUrl(auth.remoteUrl) === normalizeRemoteUrl(remoteUrl);
}

export function cliAuthTokenStillValid(auth: CliAuthFile | null, skewMs = 30_000): boolean {
  if (!auth?.accessToken) return false;
  if (!auth.expiresAtMs) return true;
  return auth.expiresAtMs > Date.now() + skewMs;
}
