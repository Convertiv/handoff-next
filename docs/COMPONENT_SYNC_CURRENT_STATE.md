# Component sync with a hosted Handoff (current state)

How **local design-system repos** stay in sync with a **hosted Handoff** instance (Postgres-backed Next.js app) for **components**, **patterns**, and **markdown pages**.

## Single sync path: CLI push / pull

| Direction | Command | Transport |
|-----------|---------|-----------|
| Local → hosted | `handoff-app push` | `POST {origin}/api/sync/upload` with `Authorization: Bearer …` |
| Hosted → local | `handoff-app pull` | `GET {origin}/api/sync/changes?since=…` with the same bearer |

The hosted app stores authoritative data in **Postgres**; `sync_event` is the append-only ledger so pulls can replay history. There is **no** in-app “import from code” / “export to disk” flow—admins sync by running the CLI from a checkout with `HANDOFF_CLOUD_URL` + `HANDOFF_CLOUD_TOKEN`.

### Environment variables

**On the server:** `HANDOFF_SYNC_SECRET` (required for `/api/sync/upload`, `/api/sync/changes`, `/api/sync/status`).

**On the developer machine** (`src/cli/sync/sync-remote-env.ts`):

| Preferred | Legacy alias |
|-----------|--------------|
| `HANDOFF_CLOUD_URL` | `HANDOFF_SYNC_URL` |
| `HANDOFF_CLOUD_TOKEN` | `HANDOFF_SYNC_SECRET` |

`handoff-app sync-status` uses the same resolution as push/pull (not `HANDOFF_SYNC_*` only).

### Push (`src/cli/sync/run-push.ts`)

1. **Default:** all `pages/**/*.md`, all `entries.components` ids with `{id}.handoff.json`, all `entries.patterns` ids with JSON.
2. **Selective:** `handoff-app push --components a b --patterns p --pages index guides/foo` pushes **only** the listed categories (each flag is optional; omitted categories are skipped when any selective flag is present). Unknown ids log a warning.
3. **POST** body: `SyncUploadBody` in `src/types/handoff-sync.ts`. Server applies changes via `applyUploadedChange` in `src/app/lib/db/sync-queries.ts`.

### Pull (`src/cli/sync/run-pull.ts`, `apply-pull.ts`)

1. State: `.handoff/sync-state.json` (`remoteUrl`, `lastSyncVersion`, fingerprints).
2. Writes **`pages/`** and **`{id}.handoff.json`** under the working tree; conflicts go to `.handoff/conflicts/`.
3. **Local SQLite:** pull is **files-only** today. After pull, run `handoff-app start` again (or your usual dev restart) so the embedded DB / merged provider picks up changes. Optional future improvement: upsert pulled payloads into `.handoff/local.db` from the CLI for instant dev-server refresh without coupling the CLI to the full Drizzle stack.

### Sync status

`handoff-app sync-status` → `GET …/api/sync/status` using `getSyncRemoteUrl()` / `getSyncRemoteSecret()`.

## Diagram

```mermaid
flowchart LR
  subgraph localRepo [Local design repo]
    PagesMd["pages/**/*.md"]
    HandoffJson["id.handoff.json + declarations"]
  end

  subgraph cli [handoff-app CLI]
    Push["push"]
    Pull["pull"]
  end

  subgraph hosted [Hosted Handoff]
    Upload["POST /api/sync/upload"]
    Changes["GET /api/sync/changes"]
    Status["GET /api/sync/status"]
    PG[(Postgres)]
    SyncEv["sync_event"]
  end

  PagesMd --> Push
  HandoffJson --> Push
  Push --> Upload
  Upload --> PG
  Upload --> SyncEv

  SyncEv --> Changes
  Changes --> Pull
  Pull --> PagesMd
  Pull --> HandoffJson

  Status -.-> cli
```

## Related reading

- HTTP API (components PATCH/build, etc.): [`docs/api.md`](api.md)
- CLI commands: [`docs/cli.md`](cli.md)
- Deployment / env: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
