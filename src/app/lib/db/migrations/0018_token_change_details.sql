-- Token change-tracking parity with components: capture WHO pushed and the
-- actual before/after VALUES of changed tokens (not just key names). Idempotent.

ALTER TABLE "handoff_token_change"
  ADD COLUMN IF NOT EXISTS "pushed_by_user_id" text;

ALTER TABLE "handoff_token_change"
  ADD COLUMN IF NOT EXISTS "pushed_by_name" text;

-- { added: {key: value}, removed: {key: value}, modified: {key: {before, after}} }
-- Bounded to changed keys per push; large all-added pushes (e.g. first snapshot)
-- omit value bodies (see insertTokensSnapshot DETAIL_CAP).
ALTER TABLE "handoff_token_change"
  ADD COLUMN IF NOT EXISTS "change_details" jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user') THEN
    BEGIN
      ALTER TABLE "handoff_token_change"
        ADD CONSTRAINT "handoff_token_change_pushed_by_user_id_user_id_fk"
        FOREIGN KEY ("pushed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
