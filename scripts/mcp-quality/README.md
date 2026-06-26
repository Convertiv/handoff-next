# MCP quality harness (roadmap Phase E)

Measures whether AI-generated output actually uses a registry's **real** design system —
turning the manual spike (6 subagents, hand-scored) into a repeatable check.

## Pieces

| File | Role | Phase |
|------|------|-------|
| `golden-prompts.ts` | Committed prompt set across token / component / icon / brand categories. Expectations are *kinds* of markers, not hardcoded values, so the set stays valid as a registry changes. | E1 |
| `score.ts` | Pure, unit-tested scorer: `buildGroundTruth` (from live MCP payloads) + `scoreResponse` (coverage per expected marker kind) + `aggregate`. | E2 |
| `run.ts` | Runner: builds ground truth over the live MCP, then scores a captured transcript. | E2 |

Tests: `test/mcp-quality-score.test.ts` (registered in `test:unit`).

## Usage

```bash
# Build ground truth + score a captured transcript (offline, no model needed):
HANDOFF_MCP_URL=https://<registry>.vercel.app HANDOFF_MCP_TOKEN=<jwt> \
  npm run mcp:quality -- --transcript transcript.json --threshold 0.8

# Or pass connection as flags:
npm run mcp:quality -- --registry https://<registry>.vercel.app --token <jwt> --transcript transcript.json
```

`transcript.json` is `{ "<promptId>": "<model response text>" }`. Exits non-zero when mean
coverage is below `--threshold` (default 0.8) — suitable as a gate.

With no `--transcript`, it prints the ground-truth summary and the prompt ids, then exits 0.

## Capturing a transcript

The scorer is model-agnostic — it scores text. To produce a transcript you drive each golden
prompt through a model **with this registry's MCP tools attached** and record the final text
keyed by prompt id. That live-model loop needs a model client + API key and is intentionally
**not** in `run.ts` (it would be unverifiable here). Two ways to feed it:

- **Manual / spike:** paste a Claude Code session's answers into a transcript file.
- **CI (Phase E3, not yet wired):** a job that runs the prompts through a model with the MCP
  connected, writes the transcript, then runs `mcp:quality --transcript … --threshold 0.8` and
  fails the build on a drop. Gating belongs on changes to `src/app/lib/mcp/**`. There's no
  `.github/workflows` in this repo yet, so this is documented, not implemented.

## Heuristic note

Coverage is intentionally a presence check, not exact match. Distinctive markers (hex values,
`$color-*` / `--spacing-*` names, specific icon ids) score reliably; generic component ids that
are also common words (e.g. `button`, `card`) can false-positive. Prefer distinctive expectation
kinds when adding prompts.
