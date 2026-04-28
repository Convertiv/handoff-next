import crypto from 'crypto';
import fs from 'fs-extra';

export async function sha256File(absPath: string): Promise<string | null> {
  if (!(await fs.pathExists(absPath))) return null;
  const buf = await fs.readFile(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256String(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
