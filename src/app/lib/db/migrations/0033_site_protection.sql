-- Site password — a shared-secret curtain in front of the deployment (`docs/SITE-PASSWORD.md`).
--
-- ⚠️ **Numbered 0033, skipping 0032 on purpose.** `feature/hubspot-cms` holds `0032_cms_connections.sql` with
-- journal idx 30. Numbering this one 0032 too would collide on both the filename and the idx the moment either
-- branch merges. Whichever lands second, check that `meta/_journal.json` ends up ordered by `when` — Drizzle
-- walks the array in order and compares against the newest applied row.
--
-- A dedicated table rather than a key in an existing settings blob: `handoff_design_workspace` and the
-- appearance row both hand their whole `settings` object to callers, and a password hash living in one of those
-- is one careless GET away from being served.

CREATE TABLE IF NOT EXISTS "handoff_site_protection" (
  -- Singleton, matching `handoff_registry_config`. One curtain per deployment.
  "id" text PRIMARY KEY NOT NULL DEFAULT 'default',
  "enabled" boolean NOT NULL DEFAULT false,
  -- bcrypt, through the existing hashPassword(). Null while protection has never been configured.
  "password_hash" text,
  -- Optional, shown on the unlock page. NEVER the password itself, and it is public by definition.
  "hint" text,
  /*
   * Bumped whenever the password changes, and embedded in every unlock cookie.
   *
   * This is what makes rotation mean anything: without it, changing the password would lock out exactly nobody
   * who was already inside — which is the one thing a person rotating a password is trying to achieve. It also
   * gives "lock everyone out now" for free, by bumping without changing the secret.
   */
  "epoch" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp DEFAULT now(),
  "updated_by" text
);

-- The row is expected to exist; the gate treats "no row" and "disabled" identically, so this is a convenience
-- rather than a requirement.
INSERT INTO "handoff_site_protection" ("id", "enabled", "epoch")
VALUES ('default', false, 1)
ON CONFLICT ("id") DO NOTHING;

DO $$ BEGIN
  ALTER TABLE "handoff_site_protection"
    ADD CONSTRAINT "handoff_site_protection_updated_by_fk"
    FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
