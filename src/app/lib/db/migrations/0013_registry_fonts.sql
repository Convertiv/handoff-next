CREATE TABLE IF NOT EXISTS "handoff_registry_font" (
  "filename" text PRIMARY KEY,
  "family_key" text NOT NULL,
  "family" text NOT NULL,
  "weight" integer NOT NULL DEFAULT 400,
  "style" text NOT NULL DEFAULT 'normal',
  "format" text NOT NULL,
  "data" text NOT NULL,
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "handoff_registry_font_family_key_idx" ON "handoff_registry_font" ("family_key");
