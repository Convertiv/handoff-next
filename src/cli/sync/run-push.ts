import matter from 'gray-matter';
import fs from 'fs-extra';
import path from 'path';
import type { SyncUploadBody } from '../../types/handoff-sync';
import type Handoff from '../../index';
import { Logger } from '../../utils/logger';
import { getDeclarationAbsPathForEntity } from './resolve-declaration';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  if (!(await fs.pathExists(rootDir))) return out;
  const walk = async (dir: string) => {
    const names = await fs.readdir(dir);
    for (const n of names) {
      const p = path.join(dir, n);
      const st = await fs.stat(p);
      if (st.isDirectory()) await walk(p);
      else if (n.endsWith('.md')) out.push(p);
    }
  };
  await walk(rootDir);
  return out;
}

async function readComponentOrPatternJson(handoff: Handoff, kind: 'component' | 'pattern', id: string): Promise<Record<string, unknown> | null> {
  const decl = getDeclarationAbsPathForEntity(handoff, kind, id);
  if (!decl) return null;
  const dir = path.dirname(decl);
  const jsonPath = path.join(dir, `${id}.handoff.json`);
  if (await fs.pathExists(jsonPath)) {
    return (await fs.readJson(jsonPath)) as Record<string, unknown>;
  }
  if (decl.endsWith('.json')) {
    return (await fs.readJson(decl)) as Record<string, unknown>;
  }
  return null;
}

/**
 * Scan local project and POST declarations + pages to the remote Handoff API.
 */
export async function runPush(handoff: Handoff): Promise<void> {
  const baseUrl = requireEnv('HANDOFF_SYNC_URL').replace(/\/$/, '');
  const secret = requireEnv('HANDOFF_SYNC_SECRET');

  const changes: SyncUploadBody['changes'] = [];

  const pagesDir = path.join(handoff.workingPath, 'pages');
  const mdFiles = await collectMarkdownFiles(pagesDir);
  for (const abs of mdFiles) {
    const raw = await fs.readFile(abs, 'utf8');
    const parsed = matter(raw);
    const slug = path.relative(pagesDir, abs).replace(/\\/g, '/').replace(/\.md$/i, '');
    changes.push({
      entityType: 'page',
      entityId: slug,
      action: 'update',
      data: { slug, frontmatter: parsed.data as Record<string, unknown>, markdown: parsed.content },
    });
  }

  const compIds = Object.keys(handoff.runtimeConfig?.entries?.components ?? {});
  for (const id of compIds) {
    const data = await readComponentOrPatternJson(handoff, 'component', id);
    if (!data) {
      Logger.warn(`Skipping component "${id}" (no ${id}.handoff.json next to declaration — push supports JSON declarations only).`);
      continue;
    }
    changes.push({
      entityType: 'component',
      entityId: id,
      action: 'update',
      data: { id, ...data, data: (data as { data?: unknown }).data ?? data },
    });
  }

  const patIds = Object.keys(handoff.runtimeConfig?.entries?.patterns ?? {});
  for (const id of patIds) {
    const data = await readComponentOrPatternJson(handoff, 'pattern', id);
    if (!data) {
      Logger.warn(`Skipping pattern "${id}" (no ${id}.handoff.json next to declaration — push supports JSON declarations only).`);
      continue;
    }
    changes.push({
      entityType: 'pattern',
      entityId: id,
      action: 'update',
      data: { id, ...data, data: (data as { data?: unknown }).data ?? data },
    });
  }

  if (!changes.length) {
    Logger.warn('Nothing to push (no pages or JSON declarations found).');
    return;
  }

  const url = `${baseUrl}/api/sync/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes } as SyncUploadBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync push failed (${res.status}): ${text || res.statusText}`);
  }

  const body = (await res.json()) as { appliedCount?: number };
  Logger.success(`Push complete: ${body.appliedCount ?? changes.length} change(s) applied on server.`);
}
