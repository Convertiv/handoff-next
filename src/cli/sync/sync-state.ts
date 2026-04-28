import fs from 'fs-extra';
import path from 'path';

export type EntityFingerprint = {
  /** Path relative to project root */
  relativePath: string;
  sha256: string;
};

export type HandoffSyncStateFile = {
  remoteUrl: string;
  lastSyncVersion: number;
  lastSyncAt: string;
  fingerprints: Record<string, EntityFingerprint>;
};

const STATE_DIR = '.handoff';
const STATE_FILE = 'sync-state.json';

export function getSyncStatePath(workingPath: string): string {
  return path.join(workingPath, STATE_DIR, STATE_FILE);
}

export async function readSyncState(workingPath: string): Promise<HandoffSyncStateFile | null> {
  const p = getSyncStatePath(workingPath);
  if (!(await fs.pathExists(p))) return null;
  try {
    return (await fs.readJson(p)) as HandoffSyncStateFile;
  } catch {
    return null;
  }
}

export async function writeSyncState(workingPath: string, state: HandoffSyncStateFile): Promise<void> {
  const dir = path.join(workingPath, STATE_DIR);
  await fs.mkdirp(dir);
  await fs.writeJson(getSyncStatePath(workingPath), state, { spaces: 2 });
}

export function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}
