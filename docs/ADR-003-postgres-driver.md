# ADR-003: Postgres Driver — Stay on Tuned `postgres-js`, Gate `neon-http` on a Benchmark

**Status:** Proposed
**Date:** 2026-07-24
**Deciders:** Brad Mering
**Context:** Phase 2.3 of [WORKBENCH-PLAYGROUND-ROADMAP.md](WORKBENCH-PLAYGROUND-ROADMAP.md)

---

## Context

The registry app connects to Neon Postgres via **`postgres-js`** (`drizzle-orm/postgres-js` + `postgres@3`),
with the client cached on `globalThis` and — after Phase 0 — pooler-aware options (`prepare:false` on the
Neon `-pooler` endpoint, `connect_timeout`, `idle_timeout`). Migrations run through the same driver
(`auto-migrate.ts`, `max:1`) using plain multi-statement `.sql` files.

The Phase-1 root-cause fix (base64 images → Blob) removed the dominant latency source, so the driver is no
longer on the critical path for the slowness we set out to fix. The open question is whether the
**serverless cold-start cost** of `postgres-js` (raw TCP+TLS handshake + auth on a cold isolate) justifies
moving reads/writes to the **Neon serverless HTTP driver** (`@neondatabase/serverless` via
`drizzle-orm/neon-http`), which issues each query as a stateless HTTPS fetch with no connection to warm up.

Two facts reshape the tradeoff:

1. **Vercel Fluid Compute reuses instances across requests** (now the default). The `globalThis`-cached
   `postgres-js` pool persists across invocations on a warm instance, so the TCP/TLS handshake is paid on
   *cold* isolates only — not per request. This is the classic weakness of long-lived-connection drivers on
   serverless, and Fluid Compute substantially blunts it.
2. **Migrations depend on `postgres-js` semantics.** The hand-written migrations are multi-statement `.sql`
   files with no `--> statement-breakpoint` markers; they run as a single multi-statement query. The HTTP
   driver executes one statement per request and would not run these as-is. So migrations stay on
   `postgres-js` regardless — any runtime switch is a **hybrid**, not a full replacement.

### `neon-http` — pros / cons for this app

- **Pro:** no connection to establish → best-case cold-start latency; stateless, no pool to exhaust against
  the small-Neon connection cap; purpose-built for short-lived serverless functions.
- **Con:** each query is a separate HTTPS round trip (no intra-request pipelining the way a live connection
  gives); multi-statement transactions become multiple round trips via `transaction()`; no session features
  (`SET`, `LISTEN/NOTIFY`, advisory locks); a second driver + code path to maintain alongside the
  `postgres-js` migrator; migration-safety and any transactional write paths must be audited before a switch.

## Decision

**Stay on tuned `postgres-js` for now. Do not adopt `neon-http` speculatively.** Fluid Compute keeps the
pool warm, Phase 0 made the pooler path correct (`prepare:false`), and the acute latency source is already
gone — so a driver swap is churn + a second code path for an unproven win.

**Adopt `neon-http` (hybrid: HTTP for runtime queries, `postgres-js` retained for migrations) only if a
benchmark shows a real problem** — specifically either of:

- **Cold-start DB latency** at p95 materially hurting first-request time (target: DB connect+first-query
  under ~150ms warm; investigate if cold p95 is many hundreds of ms and cold isolates are frequent), **or**
- **Connection pressure** on small Neon — recurring `too many connections` / pooler saturation under real
  concurrency that `idle_timeout`/`max` tuning can't resolve.

## Benchmark plan (run before revisiting)

1. **Instrument** DB connect + first-query latency, tagged cold vs warm (cold = new isolate), exported to
   logs/metrics. Capture p50/p95/p99.
2. **Observe production** across the 4 beta sites for a week: cold-start frequency (Fluid Compute reuse
   rate), DB latency percentiles, and any Neon connection-cap errors.
3. **Canary A/B** (only if step 2 flags pain): a single read-heavy route behind `neon-http` vs the
   `postgres-js` baseline, compared under a load test at expected concurrency.
4. **Decide on data:** switch runtime reads/writes to `neon-http` only if the canary shows a clear p95
   win at the concurrency we actually see, with migration + transaction paths audited safe. Otherwise keep
   `postgres-js` and revisit only on a threshold breach.

## Consequences

- **Now:** no code change. `postgres-js` + Phase 0 pooler config + `globalThis` pool is the supported path;
  this ADR records *why* we didn't switch, so it isn't re-litigated from vibes.
- **If we switch later:** it is a hybrid (HTTP runtime, `postgres-js` migrator); expect an audit of
  transactional writes and a per-query round-trip cost tradeoff. Track under a follow-up ADR that supersedes
  this one with the benchmark numbers that justified it.
