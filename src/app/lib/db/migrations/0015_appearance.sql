CREATE TABLE IF NOT EXISTS "handoff_registry_appearance" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "settings" jsonb NOT NULL DEFAULT '{}',
  "css" text NOT NULL DEFAULT '',
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
