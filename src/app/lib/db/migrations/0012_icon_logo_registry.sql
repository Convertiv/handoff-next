CREATE TABLE IF NOT EXISTS "handoff_registry_icons" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "catalog" jsonb NOT NULL DEFAULT '[]',
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "handoff_registry_logos" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "logo_set" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
