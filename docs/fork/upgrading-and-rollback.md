# Upgrading and rolling back (fork)

Always take a database backup before changing versions (Admin → Settings → System → Backups, or
`pg_dump` against the database container).

## Upgrading

1. Back up the database.
2. Check out (or pull) the new release tag and rebuild: `docker compose -f docker-compose.local.yml build`
   then `up -d`. Migrations run automatically on start.
3. Open Settings → Top Picks → Auto-Request and use **Preview Auto-Requests** before the next
   scheduled run, especially after an upgrade that changes the selection strategy.

## Database changes

| Migration | Release | Change |
| --- | --- | --- |
| `0115_top_picks_requester_and_seasons` | fork.1 | adds `auto_request_seerr_user_id` and `series_auto_request_seasons` to `top_picks_config` |
| `0116_auto_request_rules` | fork.2 | adds `movies_auto_request_rules` and `series_auto_request_rules` (JSON) to `top_picks_config` |

fork.3 and fork.4 add **no migration**: their settings (`chart` strategy, `skipUnreleased`,
`skippedTitles`) are stored inside the JSON of migration 0116. All migrations are additive, so
older images keep running against a migrated database.

## Rolling back is NOT just "start the old image"

The auto-request rules are stored as JSON and validated strictly. A build that does not know a
field **ignores or rejects the rules and falls back to defaults, which means no filters**. It
would then request titles you had excluded. So, before starting an older build:

1. **Pause auto-request** for movies and series (Settings → Top Picks → Auto-Request).
2. Make the stored rules readable by the older build:

| Going back to | Do this (run in the database container) |
| --- | --- |
| fork.3 | remove the skipped list |
| fork.2 | also remove `skipUnreleased` and change strategy `chart` to `strict` |
| fork.1, or the upstream image | rules are ignored; keep auto-request paused or accept unfiltered requests |

```sql
-- fork.4 -> fork.3: remove the skipped-titles list (note the list first if you want to keep it)
UPDATE top_picks_config SET
  movies_auto_request_rules = movies_auto_request_rules - 'skippedTitles',
  series_auto_request_rules = series_auto_request_rules - 'skippedTitles';

-- fork.3 -> fork.2: additionally drop skipUnreleased and use Strict instead of Top N Eligible
UPDATE top_picks_config SET
  movies_auto_request_rules = (movies_auto_request_rules - 'skippedTitles' - 'skipUnreleased')
    || CASE WHEN movies_auto_request_rules->>'strategy' = 'chart' THEN '{"strategy":"strict"}'::jsonb ELSE '{}'::jsonb END,
  series_auto_request_rules = (series_auto_request_rules - 'skippedTitles' - 'skipUnreleased')
    || CASE WHEN series_auto_request_rules->>'strategy' = 'chart' THEN '{"strategy":"strict"}'::jsonb ELSE '{}'::jsonb END;
```

3. Start the older build, check **Preview** (fork.2 and later), then re-enable auto-request.

The maintainer's production scripts do exactly this sequence; they are not part of this repository
because they are specific to one installation.

## Returning to upstream Aperture

Switch the image back to the upstream project's image. The extra columns stay in the database and
are harmless. Upstream will not use the requester, season or rules settings.

## Differences from upstream you should know about

- The **default** auto-request strategy is *Top N Eligible* (a chart of the first N ranked titles
  that pass your filters; owned and already-requested titles hold a place but are not requested again).
  Upstream's behaviour is available as *Missing-first*.
- With default rules and a fresh install nothing is excluded, but the strategy still differs, so
  review the preview before enabling auto-request.
