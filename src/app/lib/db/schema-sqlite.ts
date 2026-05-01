import { sql } from 'drizzle-orm';
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** SQLite mirror of schema-pg for local zero-config mode (same physical table names). */

export const users = sqliteTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp' }),
  image: text('image'),
  role: text('role').notNull().default('member'),
  passwordHash: text('password_hash'),
});

export const passwordResetTokens = sqliteTable('password_reset_token', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
});

export const accounts = sqliteTable(
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

export const sessions = sqliteTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp' }).notNull(),
});

export const verificationTokens = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: integer('expires', { mode: 'timestamp' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

export const handoffComponents = sqliteTable('handoff_component', {
  id: text('id').primaryKey(),
  path: text('path'),
  title: text('title').notNull().default(''),
  description: text('description'),
  group: text('group'),
  image: text('image'),
  type: text('type'),
  properties: text('properties', { mode: 'json' }).$type<unknown>(),
  previews: text('previews', { mode: 'json' }).$type<unknown>(),
  data: text('data', { mode: 'json' }).$type<unknown>(),
  source: text('source').notNull().default('disk'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const handoffPatterns = sqliteTable('handoff_pattern', {
  id: text('id').primaryKey(),
  path: text('path'),
  title: text('title').notNull().default(''),
  description: text('description'),
  group: text('group'),
  tags: text('tags', { mode: 'json' }).$type<unknown>(),
  components: text('components', { mode: 'json' }).$type<unknown>(),
  data: text('data', { mode: 'json' }).$type<unknown>(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('build'),
  thumbnail: text('thumbnail'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const handoffDesignArtifacts = sqliteTable('handoff_design_artifact', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('draft'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull().default(''),
  sourceImages: text('source_images', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  componentGuides: text('component_guides', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  foundationContext: text('foundation_context', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  conversationHistory: text('conversation_history', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  metadata: text('metadata', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  assets: text('assets', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  assetsStatus: text('assets_status').notNull().default('none'),
  publicAccess: integer('public_access', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const handoffTokensSnapshots = sqliteTable('handoff_tokens_snapshot', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  payload: text('payload', { mode: 'json' }).notNull().$type<unknown>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const editHistory = sqliteTable('edit_history', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  diff: text('diff', { mode: 'json' }).$type<unknown>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const handoffEventLog = sqliteTable('handoff_event_log', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
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
  estimatedCostUsd: real('estimated_cost_usd'),
  requestPreview: text('request_preview'),
  metadata: text('metadata', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const componentBuildJobs = sqliteTable('component_build_job', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  componentId: text('component_id').notNull(),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const figmaFetchJobs = sqliteTable('figma_fetch_job', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  triggeredByUserId: text('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const handoffPages = sqliteTable('handoff_page', {
  slug: text('slug').primaryKey(),
  frontmatter: text('frontmatter', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  markdown: text('markdown').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const syncEvents = sqliteTable('sync_event', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const handoffReferenceMaterials = sqliteTable('handoff_reference_material', {
  id: text('id').primaryKey(),
  content: text('content').notNull().default(''),
  generatedAt: integer('generated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  metadata: text('metadata', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
});

export const componentGenerationJobs = sqliteTable('component_generation_job', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  artifactId: text('artifact_id')
    .notNull()
    .references(() => handoffDesignArtifacts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  componentId: text('component_id').notNull(),
  renderer: text('renderer').notNull().default('handlebars'),
  status: text('status').notNull().default('queued'),
  iteration: integer('iteration', { mode: 'number' }).notNull().default(0),
  maxIterations: integer('max_iterations', { mode: 'number' }).notNull().default(3),
  a11yStandard: text('a11y_standard').notNull().default('none'),
  behaviorPrompt: text('behavior_prompt').notNull().default(''),
  useExtractedAssets: integer('use_extracted_assets', { mode: 'boolean' }).notNull().default(true),
  generationLog: text('generation_log', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  validationResults: text('validation_results', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  visualScore: real('visual_score'),
  lastBuildJobId: integer('last_build_job_id', { mode: 'number' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});
