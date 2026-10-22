-- Top Picks auto-request: configurable requester and TV season behavior.
-- Additive only (safe to roll back to an earlier image: older code ignores these columns).
--
-- auto_request_seerr_user_id: Seerr user ID credited with automatic Top Picks requests
--   (movies and TV). NULL = no requester sent (Seerr attributes to the API key owner;
--   this is the original upstream behavior).
-- series_auto_request_seasons: which seasons automatic TV requests ask for.
--   'all'   = every season (original upstream behavior)
--   'first' = season 1 only

ALTER TABLE top_picks_config
  ADD COLUMN auto_request_seerr_user_id INTEGER,
  ADD COLUMN series_auto_request_seasons TEXT NOT NULL DEFAULT 'all'
    CHECK (series_auto_request_seasons IN ('all', 'first'));

COMMENT ON COLUMN top_picks_config.auto_request_seerr_user_id IS 'Seerr user ID credited with automatic Top Picks requests; NULL = default (API key owner)';
COMMENT ON COLUMN top_picks_config.series_auto_request_seasons IS 'Seasons requested by automatic TV requests: all | first';
