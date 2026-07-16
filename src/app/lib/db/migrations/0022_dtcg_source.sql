-- Reference-preserving, multi-axis DTCG source-of-truth tree (P1.6a).
-- Holds a handoff-core Types.DtcgSource: { schemaVersion, axes[], tokens } where
-- token leaves keep {group.path} aliases UNRESOLVED and carry per-axis
-- (brand × scheme × …) values in $valuesByAxis, plus the sync spine
-- $extensions.handoff.{originalId, syncState} (which the flat `brands` cache and
-- the normalizer drop). This is the query/visualization + diff source; the hot
-- theme.css path keeps serving precompiled css/scss/tailwind bytes (ADR-001 §2).
--
-- Additive & back-compat: existing registries keep rendering from precompiled
-- bytes + the flat `brands` map. dtcg_source stays '{}' until a registry re-pushes
-- with references (a Figma-sync commit, or an upgraded workspace pipeline) — there
-- is NO forced re-ingest. A registry stays single-axis/literal until then.
ALTER TABLE handoff_registry_dtcg
  ADD COLUMN IF NOT EXISTS dtcg_source JSONB NOT NULL DEFAULT '{}';

-- Team-shared axis mapping config (Dtcg.AxisMappingConfig): which Figma collection
-- projects to which axis (brand/scheme/…), category/tier hints, include/excludes,
-- and per-variable $type overrides. Persisted on commit so repeat Figma syncs — and
-- a future headless REST sync — reuse the same curate-time decisions. '{}' = unset.
ALTER TABLE handoff_registry_dtcg
  ADD COLUMN IF NOT EXISTS axis_mapping JSONB NOT NULL DEFAULT '{}';
