ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'build' NOT NULL;
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "thumbnail" text;

DO $$ BEGIN
  ALTER TABLE "handoff_pattern"
    ADD CONSTRAINT "handoff_pattern_user_id_user_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."user"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
