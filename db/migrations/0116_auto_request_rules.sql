-- Auto-request rules (strategy, target count, content filters), per media type, stored as JSON.
-- Additive only: an empty object means "all defaults", which reproduces the behavior from before
-- this migration (older images ignore these columns). See packages/core/src/topPicks/autoRequestRules.ts
-- for the shape and the defaults.

ALTER TABLE top_picks_config
  ADD COLUMN movies_auto_request_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN series_auto_request_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN top_picks_config.movies_auto_request_rules IS 'Auto-request rules for movies (JSON, validated in application code); {} = defaults';
COMMENT ON COLUMN top_picks_config.series_auto_request_rules IS 'Auto-request rules for series (JSON, validated in application code); {} = defaults';
