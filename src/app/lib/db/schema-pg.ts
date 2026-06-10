import { boolean, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** NextAuth / Auth.js — user (+ Handoff RBAC + credentials password) */
export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  role: text('role').notNull().default('member'),
  passwordHash: text('password_hash'),
});

/** One-time password reset / invite tokens (raw token never stored). */
export const passwordResetTokens = pgTable('password_reset_token', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'date' }),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

/** Full component list row (seed from `components.json` + detail payloads). */
export const handoffComponents = pgTable('handoff_component', {
  id: text('id').primaryKey(),
  path: text('path'),
  title: text('title').notNull().default(''),
  description: text('description'),
  group: text('group'),
  image: text('image'),
  type: text('type'),
  properties: jsonb('properties'),
  previews: jsonb('previews'),
  /** Full `ComponentObject` or list row shape for round-trip */
  data: jsonb('data'),
  /** disk = imported from repo filesystem; db = created in app; figma = from Figma fetch */
  source: text('source').notNull().default('disk'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Synced component preview artifacts (HTML/CSS/JS/JSON from CLI push).
 * Server never writes here except via the push API — all builds happen locally in the workspace.
 */
export const componentArtifacts = pgTable(
  'component_artifact',
  {
    componentId: text('component_id').notNull(),
    filename: text('filename').notNull(),
    content: text('content').notNull(),
    contentType: text('content_type').notNull().default('text/plain'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.componentId, t.filename] })]
);

/**
 * Handoff-layer source files for each component (pushed from workspace, stored for display and pull).
 * Stores only the handoff layer: .handoff.ts declaration, templates, styles, scripts.
 * External dependencies (e.g. @petvet/ui in monorepos) are NOT stored here — those come from git.
 */
export const handoffComponentSources = pgTable(
  'handoff_component_source',
  {
    componentId: text('component_id')
      .notNull()
      .references(() => handoffComponents.id, { onDelete: 'cascade' }),
    /** Relative path within the component dir, e.g. 'button.handoff.ts', 'template.hbs', 'style.scss' */
    filePath: text('file_path').notNull(),
    content: text('content').notNull(),
    pushedAt: timestamp('pushed_at', { mode: 'date' }).defaultNow(),
    pushedByUserId: text('pushed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.componentId, t.filePath] })]
);

export const handoffPatterns = pgTable('handoff_pattern', {
  id: text('id').primaryKey(),
  path: text('path'),
  title: text('title').notNull().default(''),
  description: text('description'),
  group: text('group'),
  tags: jsonb('tags'),
  components: jsonb('components'),
  data: jsonb('data'),
  /** Creator/owner (playground-saved patterns). */
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** playground | build | import | ai */
  source: text('source').notNull().default('build'),
  thumbnail: text('thumbnail'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** Saved design workbench outputs for review (image + context + conversation). */
export const handoffDesignArtifacts = pgTable('handoff_design_artifact', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  /** draft | review | approved */
  status: text('status').notNull().default('draft'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Final image (data URL or public path). */
  imageUrl: text('image_url').notNull().default(''),
  /** Uploaded reference images: { name, dataUrl }[] */
  sourceImages: jsonb('source_images').notNull().default([]),
  /** Selected component guides: { id, title, previewUrl?, propertiesSummary? }[] */
  componentGuides: jsonb('component_guides').notNull().default([]),
  /** Snapshot of foundations sent to AI. */
  foundationContext: jsonb('foundation_context').notNull().default({}),
  /** Iteration history: { role, prompt, imageUrl, timestamp }[] */
  conversationHistory: jsonb('conversation_history').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  /** Extracted composite assets: { label, imageUrl, prompt }[] */
  assets: jsonb('assets').notNull().default([]),
  /** none | pending | extracting | done | failed */
  assetsStatus: text('assets_status').notNull().default('none'),
  /** Structured component specification (ComponentSpec JSON). Generated after extraction. */
  componentSpec: jsonb('component_spec'),
  /** Editable markdown version of the spec. Authoritative after first user edit. */
  componentSpecMd: text('component_spec_md'),
  /** none | pending | generating | done | failed */
  specStatus: text('spec_status').notNull().default('none'),
  /** When true, public share API and share page may expose safe fields. */
  publicAccess: boolean('public_access').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
});

export const handoffTokensSnapshots = pgTable('handoff_tokens_snapshot', {
  id: serial('id').primaryKey(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Append-only record of each tokens push and the diff from the previous snapshot.
 * One row per push, computed at push time by comparing consecutive snapshots.
 * Token keys follow the format "<category>/<name>", e.g. "colors/primary".
 */
export const handoffTokenChanges = pgTable('handoff_token_change', {
  id: serial('id').primaryKey(),
  pushedAt: timestamp('pushed_at').defaultNow(),
  trigger: text('trigger').notNull().default('push'),
  addedCount: integer('added_count').notNull().default(0),
  removedCount: integer('removed_count').notNull().default(0),
  modifiedCount: integer('modified_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  addedKeys: jsonb('added_keys').notNull().default([]),
  removedKeys: jsonb('removed_keys').notNull().default([]),
  modifiedKeys: jsonb('modified_keys').notNull().default([]),
  /** FK to the snapshot that triggered this record (nullable for safety). */
  snapshotId: integer('snapshot_id').references(() => handoffTokensSnapshots.id, { onDelete: 'set null' }),
});

/**
 * Append-only record of each page push.
 * Captures action (created/updated/deleted), who pushed, and basic content diff.
 */
export const handoffPageChanges = pgTable('handoff_page_change', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  action: text('action').notNull(), // 'created' | 'updated' | 'deleted'
  pushedAt: timestamp('pushed_at').defaultNow(),
  pushedByUserId: text('pushed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  pushedByName: text('pushed_by_name'),
  trigger: text('trigger').notNull().default('push'),
  titleBefore: text('title_before'),
  titleAfter: text('title_after'),
  markdownLengthBefore: integer('markdown_length_before'),
  markdownLengthAfter: integer('markdown_length_after'),
});

export const editHistory = pgTable('edit_history', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  diff: jsonb('diff'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** Append-only event/audit log across auth, fetch/build pipelines, and AI usage/costs. */
export const handoffEventLog = pgTable('handoff_event_log', {
  id: serial('id').primaryKey(),
  category: text('category').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull().default('success'),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  route: text('route'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  provider: text('provider'),
  model: text('model'),
  estimatedInputTokens: integer('estimated_input_tokens'),
  estimatedOutputTokens: integer('estimated_output_tokens'),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 }),
  requestPreview: text('request_preview'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
});

/** Async preview build queue — RETIRED. Builds happen locally in workspace only. Table kept for historical rows. */
export const componentBuildJobs = pgTable('component_build_job', {
  id: serial('id').primaryKey(),
  componentId: text('component_id').notNull(),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

/** Async GUI-triggered Figma token fetch jobs (dynamic mode). */
export const figmaFetchJobs = pgTable('figma_fetch_job', {
  id: serial('id').primaryKey(),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  triggeredByUserId: text('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

/**
 * Doc page content for dynamic mode + sync (slug is path under `pages/`, e.g. `getting-started/install`).
 * `type` lets future page renderers handle different content forms per ADR-001 §7:
 *   - markdown: default markdown rendering (current)
 *   - mdx: MDX with component embeds (stage 2)
 *   - html: workspace-rendered HTML + asset bundle (stage 3)
 *   - plugin: dynamically loaded React bundle (stage 4)
 * `assets` holds any per-page asset bundle (CSS, JS) keyed by filename — used by html/plugin types.
 */
export const handoffPages = pgTable('handoff_page', {
  slug: text('slug').primaryKey(),
  type: text('type').notNull().default('markdown'),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  markdown: text('markdown').notNull().default(''),
  assets: jsonb('assets').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Append-only feed for online/local sync. `id` is the monotonic cursor clients pass as `since`.
 * One event per component push. `changeType` lets pull be selective:
 *   'metadata_updated'  — only title/description/tags changed (no artifact re-download needed)
 *   'source_updated'    — .handoff.ts or template files changed
 *   'artifacts_updated' — built preview HTML/CSS/JS changed
 *   'full'              — all of the above (initial push or explicit full rebuild)
 */
export const syncEvents = pgTable('sync_event', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  /** Granular change type — null on legacy rows pre-dating this column. */
  changeType: text('change_type'),
  payload: jsonb('payload'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

/** LLM context docs generated from live catalog/tokens (regenerate from admin or hooks). */
export const handoffReferenceMaterials = pgTable('handoff_reference_material', {
  id: text('id').primaryKey(),
  content: text('content').notNull().default(''),
  generatedAt: timestamp('generated_at', { mode: 'date' }).defaultNow(),
  metadata: jsonb('metadata').notNull().default({}),
});

/** Team-wide design workbench settings (singleton row id = default). */
export const handoffDesignWorkspace = pgTable('handoff_design_workspace', {
  id: text('id').primaryKey().default('default'),
  designMd: text('design_md').notNull().default(''),
  brandVoice: jsonb('brand_voice').notNull().default({}),
  includeFoundations: boolean('include_foundations').notNull().default(true),
  customFoundationImageUrl: text('custom_foundation_image_url').notNull().default(''),
  componentReferences: jsonb('component_references').notNull().default({}),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Async design-to-component generation (agentic loop + Vite build).
 * Status: queued | generating | building | validating | iterating | complete | failed
 */
/**
 * RFC 8628 device authorization for Handoff CLI (`handoff-app login`).
 * `device_code` is stored hashed; plaintext is shown once to the CLI.
 */
export const cliDeviceSessions = pgTable('cli_device_session', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  deviceCodeHash: text('device_code_hash').notNull().unique(),
  userCode: text('user_code').notNull().unique(),
  status: text('status').notNull().default('pending'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  scopes: text('scopes').notNull().default('sync:read sync:write'),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
});

export const componentGenerationJobs = pgTable('component_generation_job', {
  id: serial('id').primaryKey(),
  artifactId: text('artifact_id')
    .notNull()
    .references(() => handoffDesignArtifacts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  componentId: text('component_id').notNull(),
  renderer: text('renderer').notNull().default('handlebars'),
  status: text('status').notNull().default('queued'),
  iteration: integer('iteration').notNull().default(0),
  maxIterations: integer('max_iterations').notNull().default(3),
  a11yStandard: text('a11y_standard').notNull().default('none'),
  behaviorPrompt: text('behavior_prompt').notNull().default(''),
  useExtractedAssets: boolean('use_extracted_assets').notNull().default(true),
  generationLog: jsonb('generation_log').notNull().default([]),
  validationResults: jsonb('validation_results').notNull().default({}),
  visualScore: numeric('visual_score', { precision: 5, scale: 4 }),
  lastBuildJobId: integer('last_build_job_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

/**
 * Per-project registry config — singleton row (id='default' until ADR-001 §7+
 * adds multi-tenancy). Stores project metadata that today comes from
 * handoff.config.js at build time and gets pushed via /api/registry/config
 * after deploy. Allows the registry Next.js app to read project title,
 * client name, breakpoints, etc. at request time without any per-project
 * build customization.
 *
 * `data` holds the full Config['app'] shape verbatim — the workspace pushes
 * its handoff.config.js's `app` block here on push:all. Registry reads it
 * via DynamicDataProvider.getConfig().
 */
export const handoffRegistryConfig = pgTable('handoff_registry_config', {
  id: text('id').primaryKey().default('default'),
  data: jsonb('data').notNull().default({}),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Theme CSS — singleton row. Workspace compiles its theme.scss / Tailwind to
 * a plain CSS file locally, then pushes the bytes here. Registry serves the
 * compiled CSS at /api/registry/theme.css with cache headers, and the root
 * layout includes it via <link rel="stylesheet">. No SCSS compilation on the
 * registry side per ADR-001 §2.
 */
export const handoffRegistryTheme = pgTable('handoff_registry_theme', {
  id: text('id').primaryKey().default('default'),
  css: text('css').notNull().default(''),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Navigation tree — singleton row. Stored as a JSON tree of:
 *   { slug, title, type, children: [...] }
 * where `type` is 'markdown' | 'mdx' | 'html' | 'plugin' | 'category' (ADR-001 §7).
 * Replaces the static staticBuildMenu() filesystem reads in registry mode.
 * Workspace pushes this tree from its derived nav structure.
 */
export const handoffRegistryNavigation = pgTable('handoff_registry_navigation', {
  id: text('id').primaryKey().default('default'),
  tree: jsonb('tree').notNull().default([]),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Immutable version snapshots for each component.
 * One row is appended every time a push results in a detectable change to a
 * component's metadata, source files, or build artifacts.
 * Identical pushes (no change from the previous version) do NOT create a row.
 *
 * `version_number`      Monotonically increasing per component (1, 2, 3…).
 * `snapshot`            Full component row at this version (title, description,
 *                       group, type, path, properties, previews, data).
 * `change_summary`      What changed vs the previous version.
 *                       { firstVersion, metadataChanged, fieldsChanged,
 *                         sourceAdded, sourceModified, sourceRemoved,
 *                         artifactsChanged, artifactCount }
 * `source_file_hashes`  { "path/file.ts": "sha256_prefix_12" } at this version.
 * `artifact_filenames`  ["index.html", "index.css", …] at this version.
 */
export const handoffComponentVersions = pgTable(
  'handoff_component_version',
  {
    id: serial('id').primaryKey(),
    componentId: text('component_id')
      .notNull()
      .references(() => handoffComponents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    pushedAt: timestamp('pushed_at', { mode: 'date' }).notNull().defaultNow(),
    pushedByUserId: text('pushed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    pushedByName: text('pushed_by_name'),
    pushedByEmail: text('pushed_by_email'),
    trigger: text('trigger').notNull().default('push'),
    // Full metadata snapshot
    snapshot: jsonb('snapshot').notNull().default({}),
    // What changed from the previous version
    changeSummary: jsonb('change_summary').notNull().default({}),
    // Source file fingerprints: { "path": "sha256[:12]" }
    sourceFileHashes: jsonb('source_file_hashes').notNull().default({}),
    // Artifact filenames present at this version
    artifactFilenames: jsonb('artifact_filenames').notNull().default([]),
  },
  (t) => [uniqueIndex('component_version_unique').on(t.componentId, t.versionNumber)]
);

/**
 * Append-only health-snapshot log. One row is inserted by the registry API
 * every time a push includes component data that carries validationResults.
 * Enables the /system/health trend chart without any workspace-side change.
 *
 * `score`           0–100, weighted average of per-component health scores.
 * `grade`           A / B+ / B / C+ / C / D / F derived from score.
 * `trigger`         'push' | 'manual' — what caused the snapshot.
 * `validatorBreakdown`  [{ id, name, passed, failed, skipped }] per validator.
 * `componentSnapshot`   [{ id, title, score, severity }] compact per-component.
 */
export const handoffValidationRuns = pgTable('handoff_validation_run', {
  id: serial('id').primaryKey(),
  runAt: timestamp('run_at', { mode: 'date' }).notNull().defaultNow(),
  trigger: text('trigger').notNull().default('push'),
  score: numeric('score', { precision: 5, scale: 2 }),
  grade: text('grade'),
  totalComponents: integer('total_components').notNull().default(0),
  validatedComponents: integer('validated_components').notNull().default(0),
  totalErrors: integer('total_errors').notNull().default(0),
  totalWarnings: integer('total_warnings').notNull().default(0),
  totalInfos: integer('total_infos').notNull().default(0),
  passedValidators: integer('passed_validators').notNull().default(0),
  skippedValidators: integer('skipped_validators').notNull().default(0),
  validatorBreakdown: jsonb('validator_breakdown').notNull().default([]),
  componentSnapshot: jsonb('component_snapshot').notNull().default([]),
});
