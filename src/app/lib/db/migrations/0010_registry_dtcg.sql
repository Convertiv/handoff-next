-- DTCG token pipeline output singleton.
-- Stores the compiled dist files from workspace tokens:build so the registry
-- can serve foundation pages without access to the workspace filesystem.
CREATE TABLE IF NOT EXISTS handoff_registry_dtcg (
  id                 TEXT PRIMARY KEY DEFAULT 'default',
  manifest           JSONB NOT NULL DEFAULT '{}',
  css                TEXT NOT NULL DEFAULT '',
  scss               TEXT NOT NULL DEFAULT '',
  tailwind           TEXT NOT NULL DEFAULT '',
  dtcg               JSONB NOT NULL DEFAULT '{}',
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
