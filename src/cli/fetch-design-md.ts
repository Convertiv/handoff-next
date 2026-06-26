/**
 * Fetch the generated DESIGN.md from a registry's MCP `handoff_export_design_md`
 * tool. Shared by `init-claude` (D3) and the push refresh (D2) so both consume
 * the single registry-generated brief (the registry is the only place that has
 * tokens + components + brand voice + guidelines together).
 */

import path from 'path';
import fs from 'fs-extra';
import { resolveSyncRemoteUrl, getSyncBearerToken } from '@handoff/cli/sync/sync-remote-env';
import { Logger } from '@handoff/utils/logger';

export async function fetchDesignMd(remoteUrl: string, bearer: string): Promise<string> {
  const url = `${remoteUrl.replace(/\/$/, '')}/api/mcp/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'handoff_export_design_md', arguments: {} },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DESIGN.md export failed (${res.status}): ${text || res.statusText}`);
  }
  // MCP streamable-HTTP frames the JSON-RPC result as an SSE `data:` line.
  const raw = await res.text();
  const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`Unexpected MCP response: ${raw.slice(0, 200)}`);
  const msg = JSON.parse(dataLine.slice('data: '.length));
  if (msg?.error) throw new Error(`MCP error: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const payload = msg?.result?.content?.[0]?.text;
  if (typeof payload !== 'string') throw new Error('MCP response had no text content.');
  const parsed = JSON.parse(payload) as { designMd?: string };
  if (typeof parsed.designMd !== 'string') throw new Error('MCP response missing `designMd`.');
  return parsed.designMd;
}

/**
 * D2 — refresh `<workingPath>/DESIGN.md` from the registry, but only if one
 * already exists (opt-in: the project ran `init-claude`). Called at the end of
 * `push:all`, after the registry data is fresh. No-op for projects that don't
 * use DESIGN.md, so it's safe to run unconditionally.
 */
export async function refreshDesignMdIfPresent(workingPath: string): Promise<void> {
  const target = path.join(workingPath, 'DESIGN.md');
  if (!(await fs.pathExists(target))) return; // not opted in — nothing to do
  const remoteUrl = await resolveSyncRemoteUrl(workingPath);
  const bearer = await getSyncBearerToken(workingPath);
  const md = await fetchDesignMd(remoteUrl, bearer);
  await fs.writeFile(target, md, 'utf-8');
  Logger.success(`Refreshed ${target}`);
}
