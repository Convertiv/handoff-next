# Handoff Design System — Roadmap

The delivery view for Handoff (the design-system platform: workspace CLI + registry app + MCP).
Authoritative specs live in their own docs — this roadmap points to them rather than duplicating:
- [COMPONENT_PREVIEW_SCHEMA.md](COMPONENT_PREVIEW_SCHEMA.md) — the component + preview standard,
  incl. **§2a contract-vs-instance**, §12a the `fields` annotation layer, §14 render isolation.
- [MCP_CLAUDE_SPIKE_REPORT.md](MCP_CLAUDE_SPIKE_REPORT.md) — the MCP/Claude spike findings.
- [schemas/component.schema.json](schemas/component.schema.json) — the component JSON Schema.

**How to read this:** [NOW](#now) is the current priority. [Tracks at a glance](#tracks-at-a-glance)
is the durable structure. [Open work](#open-work) has detail only for what isn't done. The
[Shipped ledger](#shipped-ledger) at the bottom is the condensed done-archive (full detail in git +
the spec docs).

---

## Guiding principles

1. **Canonical = file-tree-in-git.** DTCG token files + DSDS-shaped docs + a provenance envelope.
   The DB is only a presentation/MCP read model; reconciliation runs over a REST API we control.
2. **Specs are adapters, never the internal model.** The internal model is a superset (provenance,
   sync state, lineage, ownership). Import normalizes *into* canonical; export serializes *out*.
3. **Two layers, two specs.** Token *values* → **DTCG** (stable). Documentation/system layer →
   **DSDS** (draft, version-pinned, output-first). Pinned to **DSDS v0.15.2** (designsystemdocspec.org,
   repo `somerandomdude/design-system-documentation-schema`). v0.15.2 **explicitly complements DTCG,
   not replaces it** — validating this split. Its 8 entities (component / token / token-group / theme /
   foundation / pattern / guide / chunk) + 16 doc-block kinds map cleanly onto our model, and it now
   carries an **`agentDocumentBlocks`** layer (agent-facing docs alongside human `documentBlocks`) that
   lands on our author-once-project-to-agents thesis (#6). What DSDS deliberately omits — provenance,
   lineage, sync-state, ownership — is exactly our superset (#2).
4. **Each token area is a vertical slice.** Schema → seed values → human UI page → transform output.
5. **Native, not standalone.** All UI lives inside the handoff app; the standalone POC generators
   proved the shape but are not the destination.
6. **The data lifecycle is the product:** *Well-structured data → easy for devs/designers/PMs to
   update → validate & track → feed out to UI/MCP/REST.* Author once, in structured form, and
   *project* to every consumer. If a consumer can't see something, enrich the canonical data — don't
   special-case the consumer. (Contract-vs-instance §2a is this applied to the component layer.)

---

## NOW

**Track 6 — Handoff driven from Claude ⭐ FRONTLOADED (2026-06-30).** Demo-driven: put a genuinely
powerful, *write-capable* MCP in front of people. Frontloaded **ahead of** finishing the typed-React
per-component rollout (Track 2), which is paused at engine-done + Hagyard/8x8 proof.

**Hero demo flow (the north star):** one prompt-driven arc that exercises every goal —
1. create a new landing page → 2. prompt-compose it from existing components with generated
images/content, **saved in the playground** → 3. realize we need new *structural* hero functionality
→ 4. prompt a new design layout (maybe from a wireframe), **saved in the design workbench** →
5. generate a spec → 6. generate component code, push to workspace + registry → 7. swap the new hero
into the landing page.

**Immediate next:** ✅ 6.1 write surface done. 🔄 6.2 embedded apps started — the **component preview
renderer** (MCP Apps) is built (`886629b0`). Next in 6.2: embedded page-composition builder + changelog
review. See [Open work → Track 6](#track-6--handoff-driven-from-claude).
*Pending: live test against a registry + MCP-Apps client (6.1 writes + 6.2 preview app).*

**Bugs from the 8x8/SS&C pass:** (1) React not live-updating = **not a code bug** — needs the
component's `-client.mjs` rebuilt with #3's render/update + registry deployed (verify on rebuilt
Hagyard). (2) image-select crash — **FIXED** (`2ca6cd22`, `handleInputChange` immutable/primitive-safe).

---

## Tracks at a glance

Markers: ✅ shipped · 🔄 in progress · ⬜ outstanding · ⛔ externally gated.

- **Track 1 — Token canonical spine.** ✅ DTCG + `tokens:build` + CSS/SCSS/Tailwind + foundation
  pages; spacing/radius/grid live. 🔄 focus+elevation extractor. ⬜ remaining token areas · Token
  Studio ingest · DSDS export.
- **Track 2 — Component + Preview standard (typed-React builder).** ✅ schema + engine (fields
  annotations → build extraction → field builder → render bridge), proven on Hagyard + 8x8.
  🔄 **PAUSED** — per-component annotation rollout resumes after Track 6.
- **Track 3 — MCP / Claude read + context.** ✅ spike PASS · slim tools · DESIGN.md loop · quality
  harness · change-inquiry tools. ⬜ `query_tokens` · component template (gated on component.html) ·
  CI gate · `check-mcp`.
- **Track 4 — Substrate.** ✅ workbench/assets/registry plumbing · CDN image fills · Neon egress cut.
  ⬜ backlog (below).
- **Track 5 — Image sizing guide.** ⬜ self-contained; capture → store → surface.
- **Track 6 — Handoff driven from Claude.** ⭐ NOW — MCP instance-write surface + embedded apps.

---

## Open work

### Track 6 — Handoff driven from Claude

Today's MCP is ~90% *read* + a generic `sync_push`. The unlock is a coherent **write surface over
*instances*** (§2a). The shipped change-tracking + "why" layer is its **safety foundation** — every
Claude-driven write is versioned, attributed, explained, diffable. The four goals map onto
**Design↔Code × Contract↔Instance**: goal 3 (code/patch components→push) = Code×Contract = the Claude
Code + `push` loop (mostly works); goals 1/2/4 (designs, pages, playground compositions) = instance
writes = the new surface.

- ✅ **6.1 Instance write surface (DONE — no external dep).** All writes gated by `sync:write`,
  validated against the contract, version-tracked, and carry an optional `message` ("why").
  - ✅ **Playground page tools** (`4f4d5fa5`): `handoff_list_pages` / `get_page` / `create_page` /
    `update_page` — compose/read/swap component blocks (`{id, preview?, args}`), each validated against
    its component contract. Rides a shared actor-param `pattern-write.ts` core. Demo steps 1–2, 7.
    *(A playground page = a pattern, `source: playground` — distinct from doc pages.)*
  - ✅ **Preview authoring** (`88abf7ca`): `handoff_create_preview` / `update_preview` wrap the
    contract-validating registry preview CRUD (`source: llm`).
  - ✅ **Pattern changelog** (`f1b7489b`): `handoff_pattern_change` table + recording; pattern entries
    in the unified changelog + `change_why` + MCP change tools; UI renders them.
  - ✅ **Doc-page CRUD** (`f0387530`, goal 2): `handoff_list/get/create/update_doc_page`; actor-param
    `writeDocPage` upsert records `page_change` + syncs nav.
- 🔄 **6.2 Embedded Claude apps (MCP Apps — `io.modelcontextprotocol/ui`).**
  - ✅ **Component preview renderer** (`886629b0`): `handoff_preview_component` tool + a
    `ui://handoff/component-preview` HTML resource; the app (`component-preview.client.ts`, bundled
    via esbuild→base64, inlined) uses `@modelcontextprotocol/ext-apps` `App` for the handshake,
    receives the tool result, and inner-iframes the registry preview HTML (reuses §14) with width
    controls. **Caveats:** unverified here (needs a live MCP-Apps client + deploy); Claude MCP-Apps
    rendering has known open flakiness; ~384 KB inlined bundle (optimize later).
  - ⬜ Embedded **page-composition builder** (playground field builder + render bridge).
  - ⬜ Embedded **changelog/diff review** panel.
- 🔄 **6.7 Clean asset dispatch — author → verify → workbench loop (NOW, 2026-07-23).** Extends 6.1:
  make the MCP dispatch playground/workbench assets that render WELL, that Claude can verify, and
  ultimately drive the full workbench build loop. Sequenced (agreed with Brad): **Phase 1 author+verify
  together** (verification is how "clean" is proven), then **Phase 2 the full workbench loop**.
  - ✅ **Phase 1a — verify (no-chromium; "Live URLs + contract report", Brad's pick).** Grounding
    investigation established: runtime SSR of arbitrary args does NOT exist and the vendor-split makes it
    harder (bare specifiers need a browser importmap) → do NOT build runtime render now. MCP-authored
    *previews* render immediately client-side in the workbench; *pages* render live only at
    `/playground?pattern=` (`/system/pattern/` is build-time-stale). Implemented in `create-server.ts`:
    `create/update_page` now return `editUrl` (renders exact args live) + `publishedUrl` + a rebuild note
    (was returning a stale `viewUrl`); `create/update_preview` return a `verifyUrl` to the workbench
    surface; `handoff_preview_component` no longer silently 404s / wrong-renders a DB preview key (routes
    to a verifyUrl). Added a `contractReport` (empty visual slots, out-of-contract keys, per-field
    editorType) surfaced on every page/preview write — the strongest no-render "will it render well?"
    signal, and the seed for the 1b scaffold. App tsconfig clean. **Deploy-gated** (app redeploy to verify live).
  - ✅ **Phase 1b — authoring correctness.** New `handoff_scaffold_args` tool returns a ready-to-fill
    `args` template **seeded from a real preview** (correctly-shaped slots/images/arrays) + per-field
    `{editorType, shape, options}` guidance, so Claude fills values instead of guessing shapes.
    `contractReport` gained `shapeWarnings` (a provided value whose JS shape mismatches its editorType —
    e.g. an image given a bare string). Shared shape helpers (editorOf/shapeNote/placeholderValue/
    shapeMismatch) keep scaffold + report + warnings consistent. create_page/create_preview descriptions
    now point at the scaffold. App tsconfig clean. **Deploy-gated.**
  - 🔄 **Phase 2 — full workbench build loop (SCOPED 2026-07-23).** Key finding: **almost the entire loop
    already exists as server code** — the image-gen/extract/spec engines are real but **HTTP/UI-only** (driven
    by `/design`), NOT exposed as MCP tools. Phase 2 ≈ *wrapping existing engines as MCP tools + one approval
    primitive*, not new logic. There are **two distinct loops — don't conflate**:
    - **Loop A — existing component (variant previews).** prototype (`get_component`/`scaffold_args`) → build
      N candidates (`create_preview`, distinct keys) → show (`verifyUrl`/`preview_component`) → approve → save
      (already persisted at create). The component's contract IS the spec. **Fully MCP-native today except
      ONE tiny tool** (approve/promote preview, e.g. `update_preview{semantic:'canonical'}` or
      `handoff_promote_preview`). No OpenAI, no embedded apps, no new tables. ← minimal first slice.
    - **Loop B — new component (design artifact: image→extract→spec→code).** All engines exist server-side
      (`ai-client.openAiImageEdit`/gpt-image-2, `design-asset-extractor`, `design-spec-generator`,
      `design-generation-worker`) but only reachable via `/design` HTTP+SSE routes. The durable "session" is
      the `handoff_design_artifact` table — its columns already model the whole loop
      (`status: draft|review|approved`, `imageUrl`, `assets`+`assetsStatus`, `componentSpec`+`specStatus`,
      `conversationHistory`). Needs MCP wrappers: `handoff_generate_design_image` + `handoff_get_design_job`
      (**async job+poll — gpt-image is 3–4 min, a sync tool would time out**), `handoff_extract_design_assets`,
      `handoff_set_design_status` (the approval primitive), and wire `scheduleDesignAssetExtraction` into MCP
      `create_design_artifact` (parity with the HTTP route; verify `after()` fires under the MCP transport).
    - **New pieces (vs reuse):** approval primitive (the one true structural gap — status enum + UI-pick
      bridge exist, no tool records it), extract trigger, image-gen job+poll. **Follow-ons:** asset-library
      *promotion* (workbench extractor writes artifact-local `assets[]`, NOT the shared library/push-image
      pipeline — a new asset-write path, none today), and a multi-sample embedded gallery (clone
      `component-gallery`; the tool-return/`verifyUrl` path works without it — build loop tool-return-first).
    - **Recommended sequence:** Slice 1 = Loop A (1 new approve/promote tool). Slice 2 = Loop B MCP wrappers.
      Slice 3 = asset-library promotion + gallery app. Loop B code-gen tail (`generate_component_from_design`)
      is really 6.3/6.4 territory, not Phase 2 body.
    - ✅ **BUILT 2026-07-23 (Slice 1 + 2, durable-cron-runner variant — Brad's pick).** New MCP tools in
      `create-server.ts`: `handoff_promote_preview` (Loop A approve → `semantic:'canonical'`),
      `handoff_set_design_status`, `handoff_extract_design_assets`, `handoff_generate_design_image` (enqueues
      a job — no inline run), `handoff_get_design_job` (poll). Auto-extract wired into
      `handoff_create_design_artifact` (gated on `HANDOFF_AI_API_KEY`; `after()` caveat noted in-code).
      Durable runner: new authed cron route `app/api/handoff/ai/design-jobs/run` (drains ≤3 pending jobs via
      `runDesignGenerationJob`) + `vercel.json` cron `* * * * *` + `getPendingDesignGenerationJobs` query +
      tool-catalog "Design Workbench" category. App tsconfig clean; reviewed (cron auth, scopes, AI gates).
      **DEPLOY REQUIREMENTS / caveats:** (1) set **`CRON_SECRET`** in the registry env or the runner 503s
      and jobs never process; (2) **`* * * * *` needs a Vercel plan with minute-level crons** (Hobby caps at
      daily → image-gen latency unusable) — confirm plan or widen interval; (3) verify Next `after()` fires
      under the MCP transport for the auto-extract path (if not, route extraction through the same cron);
      (4) ~~minor hardening: `handoff_get_design_job` reads any jobId~~ — **wrong call, fixed in 6.8 below**:
      once artifacts became per-user this was a real cross-user leak, not a "later" nicety.
      All deploy-gated — verify live after redeploy.
  - ✅ **6.8 MCP authz parity for workbench artifacts (2026-07-25).** Audited the whole MCP surface against
    the Phase A/B authz layer (`lib/authz/policy.ts`, `grant-queries.ts`, `0024_phase_b_visibility.sql`).
    **Patterns were already safe** — `assertCanMutatePattern` lives inside the shared write core
    (`pattern-write.ts`) precisely so a different caller can't bypass it, and the authz commit wired
    `role` + `Forbidden` surfacing through MCP. **Design artifacts were not**: six tools reached them with
    no ownership check, inconsistent with the HTTP routes' own rules for the same resource —
    `get_design_artifact` / `get_component_spec` / `generate_component_from_design` / `get_design_job`
    (unscoped reads of another user's artifact incl. imageUrl, conversationHistory, spec), plus
    `set_design_status` (**no `canApprove` gate — any `sync:write` caller could approve anyone's artifact**,
    which HTTP 403s as "Only a maintainer can approve") and `extract_design_assets` (unscoped write that
    **wiped another user's extracted `assets`** and spent AI credits on their artifact).
    **Fix:** one shared `designArtifactAccess` + `denyArtifactAccess(id, 'view'|'edit'|'approve')` helper in
    `create-server.ts` mirroring `design-artifact/route.ts` exactly — baseline **owner-or-admin** (grants /
    visibility deliberately NOT access-widening for artifacts yet; HTTP defers that to the Stage 3 cutover,
    so MCP must not be more permissive than the UI), plus `computePermissions` for the lifecycle checks.
    Denials report "not found" so artifact/job ids can't be probed. `get_design_job` is now scoped to the
    caller's own jobs. `get_design_artifact` additionally stamps `permissions` so Claude can reason about
    lifecycle instead of guessing. `patternActor` now spreads the same `authzActor()` so pattern and artifact
    enforcement can't drift. Verified: all 8 artifact/job access sites gated, app tsconfig clean, 108/108
    unit tests pass. **Not covered by automated tests** (gates need a DB) — confirm live post-deploy.
    Artifact statuses match HTTP's `ALLOWED_STATUS` (`draft|review|approved`), so no vocab drift there.
    **Deferred (agreed):** preview lifecycle — `handoff_promote_preview` writes `'canonical'` into the open
    `semantic` tag, which (a) clobbers real variant meaning, (b) has **zero consumers**, and (c) is
    unenforceable since `update_preview` can set `semantic` freely under the same scope. Previews have no
    lifecycle/visibility column at all. Direction agreed = give previews a real lifecycle column + gate
    transitions on `canApprove` + stop `update_preview` writing it (option B). Not a security hole; a
    governance signal that isn't one yet.
- ⬜ **6.3 Component source-patch tool (goal 3):** expose editable source files
  (`handoff_component_sources`) for Claude Code to patch → build → push. Small; rides the existing loop.
- ⛔ **6.4 Claude Design native (goal 1):** design inside Claude Design pulling Handoff foundations
  natively — **gated on Anthropic** (Phase G). Now: the artifact bridge (`create_design_artifact` +
  `generate_component_from_design` + read-context).
- ⬜ **6.5 Brand-guidelines ingest (backlog — idea 2026-07-21).** A tool that takes a **brand
  guidelines PDF** (upload/base64) → parses it (PDF→text/vision via the AI infra) → extracts and
  **writes canonical registry data**: foundation content (color/type/spacing narrative), brand
  **voice** (→ design-workspace settings), **accessibility** conformance, logo/usage — as
  doc pages (`guidelines/*`, `foundations/*`) and workspace settings. The point: write **once** to the
  canonical source so it feeds **all three consumers** (UI pages, REST, MCP) uniformly. Rides the
  existing instance-write surface — doc-page CRUD (6.1), `writeDocPage`/nav-sync, design-workspace /
  brand-voice, the accessibility-page pattern already shipped, and the AI/PDF pipeline.
  - Decisions:
    - **Tokens where the PDF supports it, prose otherwise.** Fonts, colors, spacing, radius are pulled
      as real structured **tokens**; narrative (voice, usage, principles) becomes prose doc pages. The
      split is PDF-dependent.
    - **Human review/approval gate is required** — nothing publishes until a person confirms the
      extractions.
    - **Chunk** large, multi-section PDFs into discrete writes (settled — not a question).
- 🔄 **6.6 Vendor-isolated component-library build (NOW — started 2026-07-22, expanded 2026-07-23).**
  Today each React component's `<id>-client.mjs` hydration bundle **re-bundles React + ReactDOM
  + the entire component library per component** → ~3.3MB dev / ~1.3MB prod-min *each*. This has
  been a recurring pain: bundles too big for the push size cap (stripped → 404 → frozen preview;
  see `a2166567` prod-minify, `dcb8731e` 4MB cap) and slow to load (React re-downloaded per block).
  - **Reframe (2026-07-23):** this isn't just a preview fix — it's a **distributable, vendor-isolated
    component library** with THREE consumers: (1) in-app preview/playground, (2) static HTML / HubSpot
    / SS&C drop-in, (3) users importing the raw libraries into their own build. All three want the same
    isolation; only *how the component entry finds its vendor* differs. The shared vendor bundle **is**
    the "raw library" deliverable.
  - **Decided model (Brad, 2026-07-23): ESM + importmap, unified build now.** Externalize the shared
    packages from each per-component entry and emit them as ONE set of hashed, immutable shared ESM
    bundles referenced via an **importmap**. One portable entry artifact works everywhere; only the
    importmap base changes per host (in-app: injected into the srcdoc iframe + static preview HTML;
    HubSpot/SS&C: site-header importmap; user's own bundler: resolves the bare specifiers itself).
  - **Vendor graph (proven via scratchpad smoke test 2026-07-23).** Shared set = the React ecosystem
    (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`) + config-declared workspace
    packages (e.g. `8x8-component-library`). Each shared bundle **owns** one specifier and marks the
    others `external`, so nothing is duplicated: `react.mjs` bundles react (8kb, exposes default+named);
    `react-dom.mjs` external react; `react-dom/client.mjs` external react+react-dom; `library.mjs`
    bundles the barrel + its deep deps (framer-motion/radix/leaflet/lottie/maps ≈ 2.5MB) external react.
    Each **component entry drops to ~0.2kb** (its template only), importing the shared specifiers bare.
  - **Two mechanics the smoke test nailed:** (a) `createReactResolvePlugin`'s `onResolve` **overrides
    `external`** and re-bundles react — so the external component/library builds must run **without**
    that plugin (rely on `external` + `resolveDir`); the plugin runs only on the react-owning bundle.
    (b) 8x8's 132 components use ~70 of the library's exports incl. the maps/lottie stack, so a
    used-exports barrel wouldn't trim much → **ship the full barrel, loaded once + cached** (v1);
    per-page a used-exports/sub-split barrel is a later optimization.
  - **Config:** add `preview.sharedPackages?: string[]` to `Config` (React trio always shared;
    workspaces add their library). Generic across Cynosure/SSC/8x8 — never hardcode `8x8-component-library`.
  - **Insertion point:** new batched phase after the per-component loop in `processComponents`
    (`builder.ts:~573`, gated `if (!id)` so single-component builds keep the fat bundle). Build shared
    bundles + tiny entries + `importmap.json` + `manifest.json`; write shared files to
    `public/api/component/`, entries to `components/<id>/dist/`. Skip the per-component client esbuild
    in `ssr-render.ts:305-353` on full builds (flag) to avoid double work.
  - **Serve/push/inject:** shared `.mjs` + `importmap.json` + `manifest.json` go through
    `collectSharedComponentAssets` (push) and route to `SHARED_COMPONENT_ID` in
    `component-artifact-queries.ts`; serve route already handles 1-segment `.mjs`/json. Inject the
    importmap into the srcdoc iframe (`Preview.tsx`) and the static preview HTML head.
  - **Risks:** single-component push after a library bump references a stale hash → keep single builds
    on the fat bundle (the gate) or force a full split; stale hashed shared files accumulate → clean
    before write; importmap browser support ~94% (fine for app + modern hosts; UMD/global is the later
    fallback for older HubSpot hosts if needed).
  - **Verification:** `handoff-app build` on 8x8 → per-component `.mjs` = KB, one shared `library-*.mjs`
    + react bundle + `importmap.json` appear; browser hydrate in the playground confirms importmap
    resolves + live-edit works. **Central shared-build-tool change — verify on a real 8x8 build before
    trusting (same subsystem that just broke previews for a dozen turns).**
  - **STATUS 2026-07-23 — IMPLEMENTED + module verified end-to-end; full-build wiring pending.**
    Built: `src/transformers/preview/component/build-shared-bundles.ts` (the phase), config
    `preview.sharedPackages` (`types/config.ts`), builder wiring (`builder.ts` collects react
    components in the loop → calls the phase after it, gated `!id`), push collection
    (`collect-build-artifacts.ts` globs `hvendor-*`), registry routing (`component-artifact-queries.ts`
    routes `hvendor-*` → `__shared__`), and playground/static importmap injection (`Preview.tsx`
    fetches+injects `hvendor-importmap.json`; static HTML patched in the phase). Push-flow fix
    (`run-push.ts`): `push` builds PER-COMPONENT (`handoff.component(id)`), which skips the
    full-build-gated split phase AND clobbers tiny entries with fat ones — so a full, non-selective,
    split-enabled `push` now does ONE full build up front and skips the per-component rebuild
    (non-split projects keep the per-component path). Two runtime traps
    found + fixed via smoke tests: (a) React is CJS so `export *` gives DYNAMIC re-exports a static
    `import {jsxs}` can't see → we ENUMERATE exports (`require` keys) and emit them statically
    (esm.sh approach); (b) `react-dom`'s CJS `require('react')` throws "Dynamic require not supported"
    when react is external → we COMBINE react+react-dom into one bundle AND add a require-shim banner
    (esbuild's `__require` falls back to a banner-defined `require`) to any bundle that externalizes
    react (covers the library's CJS deps). **Verified against 8x8's REAL config hook**: hero-background
    entry 1.3MB→3.2KB, hero-split→26KB, shared react 191KB + library 2.5MB (once); a real browser
    loaded the importmap, deduped React (no invalid-hook), and hydrated hero-background to live HTML.
    NOT yet run: the full 132-component `build:components` (exercises builder wiring + HTML injection +
    push at scale) and the deployed playground. **Next:** user relinks (`npm link handoff-app` in 8x8
    — currently a stale installed copy), adds `preview.sharedPackages: ['8x8-component-library']`,
    full build + `push --force`, verify playground live-edit + `.mjs` sizes on the registry.

### Track 2 — typed-React builder rollout *(PAUSED)*

Engine is done and proven (Hagyard ProductCard + 8x8 hero-split overlay). Remaining when resumed:
- Roll `fields` annotations out across more 8x8/Hagyard components; then Cynosure/SS&C playground polish.
- Design item surfaced during the pass: **preview `args` typing** — args are typed `Partial<TProps>`,
  but an annotated field's stored value can be a different shape than its prop (e.g. image editor emits
  `{src,alt}` for a `string` prop). Sidestepped for now by keeping args prop-shaped + a `render`
  adapter; longer-term the args type may need to reflect editor values.
- Full design authoritative in [COMPONENT_PREVIEW_SCHEMA.md](COMPONENT_PREVIEW_SCHEMA.md) §12/§12a.

### Track 1 — remaining token spine

- ⬜ **Focus + elevation extractor** (shared with substrate). DTCG types + foundation pages are built
  and waiting; the gap is the `tokens:build` extractor deriving `focus` (ring width/offset/color) and
  `elevation` (shadow scale) from Tailwind utility usage. **Highest leverage-per-effort** — lights up
  idle infra.
- ⬜ Remaining token areas: sizing, breakpoints, borders, motion, opacity (each a vertical slice).
- ⬜ **Phase 4 — Token Studio ingest** (the multi-source proof; spec spike DONE). Importer =
  Style Dictionary v4 + `@tokens-studio/sd-transforms` (register `preprocessors: ['tokens-studio']`).
  **Import the NATIVE format, not TS's DTCG export** (theirs is incomplete). Gotchas captured in git
  history / spike notes: `$value`/`value` variants, type remapping (spacing/sizing→dimension,
  boxShadow→shadow), composite expansion (typography/shadow/border), inline-math eval, `{alias}`
  resolution across `source` sets, `$metadata.tokenSetOrder` flatten, strip `$figma*`. Set→tier via
  `$themes[].selectedTokenSets` tri-state. Generalize the Figma crawler into the first `Source` plugin.
- ⬜ **Phase 5 — DSDS export adapter** (pinned to **v0.15.2**, output-only) + drift/reconciliation UI.
  Serialize canonical → DSDS entity docs: our component contract+previews → `component`/`chunk`; DTCG
  values → `token`/`token-group` (DSDS wraps values, doesn't own them); foundation pages → `foundation`;
  playground patterns → `pattern`; doc pages → `guide`; multi-axis themes → `theme`. Emit
  `agentDocumentBlocks` from our MCP/DESIGN.md context. Validate against
  `designsystemdocspec.org/v0.15.2/dsds.bundled.schema.json`. Watch for spec drift — it moved v0.1→0.15.2
  fast (0.15.2 dated 2026-07-16); re-check the pinned schema before building.
- ⬜ Phase 0 hardening: AJV validation of DTCG files + manifest (aspirational).

### Track 3 — remaining MCP read/context

- ⬜ **Phase B:** `query_tokens` (B1) · `export_tokens_as`/`brief` (B2) · reference-material quality (B3).
- ⬜ **Phase C:** component template (C1) — **gated on an open question: are built `component.html`
  templates stored in the registry DB after push, or only local?** Investigate before C1 (may need a
  DB column + push endpoint). Then search enrichment (C2) · usage (C3).
- ⬜ **Phase E:** CI gate (E3) + live-model capture (need infra/API key).
- ⬜ **Phase F:** `check-mcp` connectivity/scope validator · token gen.
- ⬜ Reference freshness: confirm `handoff_get_reference('tokens')` regenerates on push vs. staleness (feeds B3).

### Track 5 — Image sizing guide

Capture Figma image-slot sizing (already in the fetched node tree) as first-class guidance.
- Data model: new `handoff_image_slot` table (a slot is a *spec*, independent of assignment) —
  `componentId, variantKey, slotName, nodeId, recommended{W,H}, aspectRatio{W,H}, scaleMode,
  isResponsive, min{W,H}`.
- **A — Capture:** extend `imageAssetsFromNodeTree()` (`component-linking.ts`) to carry boundingBox /
  scaleMode / isResponsive / min — zero extra API calls; compute GCD aspect ratio.
- **B — Store:** push to `/api/registry/assets/image-slots`, idempotent upsert by (componentId, slotName, variantKey).
- **C — Surface:** per-component "Image Slots" tab + a foundation page.

### Change-tracking follow-ups

- ⬜ Backfill token `change_details` from the stored consecutive snapshots (analogous to the version-cleanup tool).
- ⬜ Token compare-two-arbitrary-snapshots view (per-push diffs already ship).
- ⬜ Design-system-native "why": link token changes ↔ the components that consume them (needs a token→component usage map).
- ⬜ Token-version diffs (tokens have change records but no per-version browser like components).

### Backlog (Track 4)

- ⬜ **Decoupled batch image endpoint** — move component-referenced images off the push payload onto a
  batched upload endpoint (mirrors fonts); removes the 1.5MB/image cap + 413 risk, enables large hero images.
- ⬜ **Push-cache invalidation on CLI capability changes** — stamp a cache/feature version so a plain
  `push:all` picks up output-changing CLI features once after upgrade (today keyed only on source hashes).
- ⬜ **OAuth-backed Figma tokens for CLI fetch** — mint short-lived Figma tokens from the registry's
  OAuth grant (`/api/figma/cli-token` reusing `getValidFigmaAccessTokenForUser`) instead of hand-managed
  PATs. Open Qs: project access scope, mid-run refresh, blast radius of the sync token, offline PAT
  fallback, read-only scope coverage.
- ⬜ **Egress follow-ups:** `getRuntimeComponent` full scans (→ by-id); visibility-gated client polling;
  `unstable_cache`/tags for static `/api/registry/*`.

### Deprioritized

- ⬜ **Validation gating** (`components:validate` build/push gate) — pushed to the bottom; enforcement
  not wanted yet. Pure validators exist and run at authoring time.

---

## Key references & load-bearing decisions

- **Contract vs instance (§2a):** component *properties/code* are code-only, replace-on-push (workspace);
  *previews/pages/compositions* are registry-contributable. Never conflate. → COMPONENT_PREVIEW_SCHEMA §2a.
- **Render isolation (§14):** previews render in an opaque-origin sandboxed iframe (`allow-scripts`, no
  `allow-same-origin`), `srcdoc` + postMessage height + CSP; route CORS on js/css. Shipped + verified.
- **DB migrations:** auto-run on boot/page-load. **NEVER `db:generate`** (snapshot intentionally drifted
  → bogus diffs) — hand-write idempotent `CREATE TABLE IF NOT EXISTS` SQL + a `_journal.json` entry.
- **Registry deploy:** registry sites deploy from handoff-app on push to `feature/mcp-prototype`.
  Workspaces consume handoff-app as a git dep (`github:Convertiv/handoff-next#feature/mcp-prototype`) —
  reinstall with `--force` to pick up a new branch commit (`prepare` rebuilds `dist`).
- **Provider parity:** MCP/consumers must read the DTCG canonical source, not just the Figma snapshot.

---

## Shipped ledger

Condensed archive (full detail in git history + the spec docs).

**Token spine (T1):** DTCG token core + `tokens:build` + CSS/SCSS/Tailwind transforms + foundation
pages; spacing / border-radius / grid areas live.

**Component + Preview standard (T2):** canonical schema drafted + validated (SS&C button round-trip)
+ §2a contract-vs-instance locked; lenient preview normalizer + enum-membership validation; unified
preview surface + component workbench (shared field builder, responsive controls); §14 hardened
opaque-origin iframe render; registry preview CRUD + 422 validation. **Typed-React builder engine:**
`fields` annotation spec §12a + `defineReactComponent` types; #1 build-time extraction
(`applyFieldAnnotations`); #2 field builder honors `editorType` + scalar array items; #3 render bridge
(`-client.mjs` exports render/update + `applyRenderFns`, reusing the hydration bundle); 8x8
enum/slot/function/any field handling; proven on Hagyard + 8x8 hero-split.

**MCP / Claude (T3):** Phase A spike PASS; `tools/list` fix; `get_tokens` slim (22K→6.6K, now serving
spacing/radius/grid); `get_component` slim (143K→~1K); `get_reference` `type` alias; DESIGN.md loop
(`export_design_md` + `init-claude` writing DESIGN.md/`.mcp.json`/CLAUDE.md + `push:all` refresh);
quality harness (golden prompts + scorer + runner, `npm run mcp:quality`).

**Change-tracking & inquiry:** versioning churn fixed (volatile-field fingerprint → canonical +
history projection + by-id fetch + one-time `cleanup-versions` admin tool); component
compare-two-versions content diff; token change parity (before/after values + pusher + expandable
diffs); capture "why" (CLI `--message` + lazy AI-drafted summary, shown in changelog + version
history); MCP inquiry tools (`recent_changes` / `component_history` / `change_why`).

**Substrate (T4):** workbench reliability; DTCG→workbench foundations; registry fonts; playground
React; asset library + library-in-workbench; nav cleanup; S3/CloudFront CDN for image fills; Neon
egress cut (list/menu column projection · `getComponent` by-id · `React.cache` per-render dedupe ·
token snapshot `LIMIT 1`).

**Fixes:** image-select crash (`handleInputChange` immutable + primitive-safe, `2ca6cd22`).
