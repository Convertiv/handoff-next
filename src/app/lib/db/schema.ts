import { integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

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

export const handoffTokensSnapshots = pgTable('handoff_tokens_snapshot', {
  id: serial('id').primaryKey(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const editHistory = pgTable('edit_history', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  diff: jsonb('diff'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** Async Vite preview build queue for dynamic component source edits */
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

/** Doc page content for dynamic mode + sync (slug is path under `pages/`, e.g. `getting-started/install`). */
export const handoffPages = pgTable('handoff_page', {
  slug: text('slug').primaryKey(),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  markdown: text('markdown').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Append-only feed for online/local sync. `id` is the monotonic cursor clients pass as `since`.
 */
export const syncEvents = pgTable('sync_event', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});
