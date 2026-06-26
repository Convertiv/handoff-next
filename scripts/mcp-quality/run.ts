/**
 * MCP quality runner (Phase E2). Builds registry ground truth over the live MCP,
 * then scores responses against the golden prompt set.
 *
 *   npx tsx scripts/mcp-quality/run.ts --registry <url> --token <jwt> [--transcript file.json] [--threshold 0.8]
 *
 * Modes:
 *   --transcript <file>  Score a captured transcript — JSON `{ "<promptId>": "<response text>" }`.
 *                        Fully offline (no model). Use this to score a Claude Code session's outputs,
 *                        or in CI against a recorded baseline. Exits non-zero if mean coverage < threshold.
 *   (no transcript)      Print the ground-truth summary and exit 0. Live-model scoring (drive each
 *                        prompt through a model with the MCP tools attached) is intentionally not
 *                        implemented here — it needs a model client + API key; wire it in CI and feed
 *                        its captured outputs back through --transcript.
 *
 * Token/registry resolution order: flags → env (HANDOFF_MCP_URL / HANDOFF_MCP_TOKEN).
 */
import fs from 'node:fs';
import { GOLDEN_PROMPTS } from './golden-prompts';
import { aggregate, buildGroundTruth, scoreResponse, type PromptScore } from './score';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const registry = (arg('registry') ?? process.env.HANDOFF_MCP_URL ?? '').replace(/\/$/, '');
const token = arg('token') ?? process.env.HANDOFF_MCP_TOKEN ?? '';
const transcriptPath = arg('transcript');
const threshold = Number(arg('threshold') ?? '0.8');

if (!registry || !token) {
  console.error('Missing registry URL or token. Pass --registry/--token or set HANDOFF_MCP_URL/HANDOFF_MCP_TOKEN.');
  process.exit(2);
}

async function mcpCall(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${registry}/api/mcp/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`No SSE data from ${tool}: ${text.slice(0, 200)}`);
  const msg = JSON.parse(line.slice(6));
  const payload = msg?.result?.content?.[0]?.text;
  return typeof payload === 'string' ? JSON.parse(payload) : msg?.result;
}

async function main() {
  console.log(`\nBuilding ground truth from ${registry} …`);
  const [tokens, components, icons, brandVoice] = await Promise.all([
    mcpCall('handoff_get_tokens').catch(() => undefined),
    mcpCall('handoff_search_components', {}).catch(() => undefined),
    mcpCall('handoff_search_icons', { query: '' }).catch(() => undefined),
    mcpCall('handoff_get_brand_voice').catch(() => undefined),
  ]);
  const gt = buildGroundTruth({ tokens, components, icons, brandVoice });
  console.log(
    `  colors:${gt.colorValues.length} colorNames:${gt.colorNames.length} cssVars:${gt.cssVariables.length} ` +
      `components:${gt.componentIds.length} icons:${gt.iconNames.length} brandTerms:${gt.brandTerms.length}`
  );

  if (!transcriptPath) {
    console.log(
      `\n${GOLDEN_PROMPTS.length} golden prompts loaded. No --transcript provided, so nothing was scored.\n` +
        `Capture model responses keyed by prompt id and re-run with --transcript to score. Prompt ids:\n  ` +
        GOLDEN_PROMPTS.map((p) => p.id).join(', ')
    );
    process.exit(0);
  }

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as Record<string, string>;
  const scores: PromptScore[] = [];
  console.log('\nid                     cat        cover  missed');
  console.log('─'.repeat(64));
  for (const p of GOLDEN_PROMPTS) {
    const response = transcript[p.id];
    if (response == null) {
      console.log(`${p.id.padEnd(22)} ${p.category.padEnd(10)} —      (no response in transcript)`);
      continue;
    }
    const s = scoreResponse(response, p.expect, gt);
    scores.push({ id: p.id, ...s });
    console.log(
      `${p.id.padEnd(22)} ${p.category.padEnd(10)} ${(s.coverage * 100).toFixed(0).padStart(3)}%   ${s.missed.join(',') || '—'}`
    );
  }

  const agg = aggregate(scores);
  console.log('─'.repeat(64));
  console.log(
    `scored ${agg.total}/${GOLDEN_PROMPTS.length} · full-pass ${agg.passed}/${agg.total} · mean coverage ${(agg.meanCoverage * 100).toFixed(1)}% · threshold ${(threshold * 100).toFixed(0)}%`
  );
  const ok = agg.meanCoverage >= threshold;
  console.log(ok ? '✅ PASS' : '❌ FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
