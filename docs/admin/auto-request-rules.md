# Auto-Request Rules (fork)

> **Fork note:** this page describes features that exist only in this personal fork of Aperture. See the repository README for the fork notice. The default selection strategy (**Top N Eligible**) differs from upstream Aperture v0.7.10; choose **Missing-first** to get the upstream behavior.

Auto-request asks Seerr for Top Picks titles that are missing from your library. These rules decide **which** titles are requested. They apply **only** to automatic requests: they never change the Top Picks libraries shown to users, personal Discover results, or manual requests.

Settings live in **Settings → Top Picks → Auto-Request Missing Content**, separately for movies and TV series.

## Selection strategies

| Strategy | What it does |
|---|---|
| **Top N Eligible (default)** | Builds a chart of the first *N* ranked titles that pass every filter. Titles already in your library or already requested in Seerr hold their place in the chart without a new request; only eligible missing titles are requested. Excluded and unreleased titles take no place, so the search continues down the ranking until *N* eligible titles are found or the depth limit is reached. It never requests extra titles just to reach *N*. |
| **Missing-first** (upstream behavior) | The behavior auto-request has always had: take the first *N* titles that are missing from your library. Titles already requested in Seerr use up one of the *N* slots and are not replaced. |
| **Strict Top N** | Looks only at the first *N* ranked titles. Anything owned, already requested or filtered out is *not* replaced, so fewer than *N* (even zero) may be requested. |
| **Fill to N** | Walks down the ranking until *N* eligible titles (missing, not yet requested, passing every filter) are found, or the depth limit is reached. |

- **Target count (N)** can be set per media type. Left empty it equals the maximum requests per run.
- **Maximum requests per run** always applies as a separate safety cap, whatever *N* is.
- **Depth limit** (Top N Eligible, Fill and Missing-first): how many ranked titles may be examined at most (10–500, default 200). TMDB lists are fetched in pages of 20.
- Titles are de-duplicated, and each title's request status is checked again right before it is requested.

### Top N Eligible in detail
Titles are evaluated in their original ranking order and never reordered by library status.

| Title state | Takes a place in the chart? | Request? |
|---|---|---|
| Eligible, in your library | Yes | No |
| Eligible, already requested or being processed in Seerr | Yes | No |
| Eligible, missing | Yes | Yes |
| Eligible, missing, but the per-run cap is already used up | Yes | Not in this run |
| Excluded by a filter, or not released yet | No | No |
| Cannot be verified (TMDB lookup failed, Seerr status unknown) | No | Never |

Filters are applied to titles you already own as well, so an owned title that matches an exclusion does not take a place. Filters run before the Seerr status check, so excluded titles cost no Seerr call.

*Example:* if the first ten ranked titles contain 3 owned, 2 unreleased, 2 excluded and 3 eligible missing titles, the chart holds the 3 owned and 3 missing titles from the top ten, then continues down the ranking for 4 more eligible titles. If those 4 are missing, the result is 3 owned and 7 requested.

### Example (Strict and Fill)
With *N* = 10: if the first ten ranked titles contain eight that are owned or excluded, **Strict** requests the other two; **Fill** keeps going down the ranking until it has ten, if there are that many.

## Ranking

The ranking is the list the strategies work through. It is shown as the **original rank** in the preview and in the job log.

- **External list order (default):** the position in the TMDB or MDBList list after the language filter. This is what auto-request has always used.
- **Hybrid blend (hybrid sources only):** the same hybrid score the Top Picks display uses, but also ranking titles that are *not* in your library.

### How a missing title is scored in the hybrid blend
The display scores each library title as `local × localWeight + external × externalWeight`, where each part is normalized to 0–100:

- **Local relevance** comes from watch history. A title that is not in your library cannot have been watched, so its local score is **0** — exactly like a library title nobody has played.
- **External score** is `(1000 − position) / 999 × 100`, the same scale the display uses for titles it matches.
- Titles the display already scores keep **exactly** the score the display gives them, so their relative order is unchanged.

Because the external score only changes by about 0.1 points per position, the ordering is dominated by local watch scores: watched library titles tend to rank above missing ones, and missing titles are ordered by their position in the external list. With **Strict Top N** under this ranking, many of the top *N* slots may be library titles, so few requests can result. The preview shows this clearly before anything is requested.

The existing language filter shapes the list before ranking, as it does for the display.

## Content filters

All filters are optional, separate for movies and TV, and use TMDB data (one lookup per title, cached in memory for 24 hours).

- **Country of origin:** exclude or include a set of countries (ISO 3166-1 codes, searchable by name). Choose whether a title matches when *any* of its origin countries is selected or only when *all* of them are. Movies use TMDB production countries; TV uses origin countries. The original language is never used as a country.
- **Genres:** exclude by TMDB genre ID (movie and TV genre lists differ). A title is skipped if it has any selected genre.
- **Skip unreleased titles:** a switch, off by default, that excludes titles whose release date is still in the future. A movie counts as released when its TMDB release date is today or earlier; a TV show when its first air date is today or earlier (one aired episode is enough). Dates are compared in UTC. A title with no date follows the empty-metadata setting below. Works with every strategy.
- **Keywords:** exclude by TMDB keyword (searched and selected from TMDB; these are *not* your media server's tags). Movie and TV keyword formats are both handled.

### Missing or failed metadata
- If TMDB **cannot be reached** or fails for a title, that title is marked **uncertain** and is **never requested**, whatever the settings say. It is never silently treated as a match or a non-match.
- If TMDB answers but a field needed by an active filter is **empty** (for example no country listed), the setting *If a title's metadata is empty* decides: **do not request it** (default) or **treat it as not matching**. An empty keyword list is a valid answer and simply means no keyword matches.

## Preview

**Preview Auto-Requests** (same card) shows, for movies and TV: original rank, title and year, library/request status, origin countries, genres, matching keywords, the decision (*will request*, skipped, excluded, uncertain, over cap) and the reasons, plus a summary and the active strategy.

With **Top N Eligible** the preview shows the final chart first, each title with its place, original rank and whether it is *in library*, *already requested*, *will request* or *over the per-run cap*, followed by a separate table of titles that took no place (excluded, unreleased or unverified) with their reasons.

- The preview is **read-only**: it never creates a Seerr request or writes to the database. It uses the **saved** settings; save first to preview edits.
- It is built by exactly the same code the scheduled job runs, so they cannot disagree.
- A preview is a snapshot. If it is more than 10 minutes old the page asks you to refresh it. **Request these now…** asks for a separate confirmation, then rebuilds the plan; if it would now request something different from what you previewed, nothing is sent and you are shown the new plan to confirm again.
- The scheduled job needs no confirmation. **Manual** runs of the auto-request job (including from the Jobs page) always ask for confirmation.

## Requester and TV seasons
See [Top Picks → Auto-Request](top-picks.md#auto-request-seerr) for the Top Picks Requester and TV season settings. They are independent of these rules.

## Storage and compatibility
Rules are stored as JSON in two new columns of the Top Picks configuration (migration `0116`); an empty value means all defaults. The migration is additive. The newer `chart` strategy and `skipUnreleased` switch are stored inside that JSON and need no further migration.

If you roll back to an earlier build that does not know these rules (for example the first fork release), it will ignore the rules and request without your filters. **Pause auto-request for movies and series before rolling back**, and re-enable it only after you are on a build that supports the rules again.

A build from before the `chart` strategy and `skipUnreleased` switch was added (the previous fork release) rejects stored rules that contain them and falls back to its defaults, which request without your filters. Before rolling back to it, pause auto-request and rewrite the stored rules without those two fields (with the strategy set to Strict or Fill).

## Limits and notes
- Depth is capped (default 200, maximum 500 ranked titles). Fill may stop at the cap before reaching *N*; the summary says when.
- Each examined, not-yet-owned title needs one TMDB lookup when a filter is active, so a deep Fill can make up to the depth cap in lookups (about 40 per second at most).
- Seerr request status is read with ordinary read-only calls; a title Seerr cannot report on is treated as not requested, and the request itself is re-checked just before it is made.
