# Aperture — independently maintained fork

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

> ## Personal fork — read this first
>
> This is an **independently maintained personal fork** of [Aperture](https://github.com/dgruhin-hrizn/aperture) by dgruhin-hrizn (AGPL-3.0). It is **not affiliated with, endorsed by or supported by the upstream project**, and support here is best effort. It is based on upstream **v0.7.10** (commit `99cc9369df`) and adds improvements to automatic Seerr requests. Everything else is upstream's work; see [NOTICE](NOTICE) for the dated list of modifications.
>
> - **Upstream project, documentation and support:** https://github.com/dgruhin-hrizn/aperture
> - **This fork's source:** https://github.com/avalynnrose/aperture (release tags look like `v0.7.10-fork.4`)
> - **The upstream container image does not include this fork's features.** Use this fork's own image (`ghcr.io/avalynnrose/aperture:<release tag>`, linux/amd64) or build from source (below).

**Aperture** — AI-powered media recommendations for Emby & Jellyfin. It creates personalized recommendation libraries for your media server users using OpenAI embeddings and pgvector similarity search, for both **movies** and **TV series**.

---

## What this fork adds

All additions concern the **Top Picks → Auto-Request** feature (Settings → Top Picks). Details: [Fork Changes](#fork-changes) and [docs/admin/auto-request-rules.md](docs/admin/auto-request-rules.md).

| Feature | Summary |
| --- | --- |
| Top Picks Requester | Choose which Seerr user is credited with automatic requests |
| TV seasons | Request all seasons or season 1 only |
| Selection strategies | **Top N Eligible** (default), Missing-first (upstream behaviour), Strict Top N, Fill to N |
| Filters | Country of origin, TMDB genres, TMDB keywords, skip unreleased titles |
| Ranking | External list order, or the hybrid blend used by the Top Picks display |
| Preview | Read-only chart of what the next run would request and why; ✕ to skip single titles |
| Safety | Per-run request cap, confirmation before manual runs, failed lookups are never requested |

### Defaults and how they differ from upstream

| Setting | This fork | Upstream v0.7.10 |
| --- | --- | --- |
| Auto-request strategy | **Top N Eligible**: a chart of the first N ranked titles that pass your filters. Titles you already own, or have already requested, hold their place without a new request; excluded and unreleased titles take none. Never requests extra titles just to reach N. | Missing-first: the first N titles that are missing from your library |
| Filters, skip-unreleased | off | not available |
| Requester | Seerr API-key account (same as upstream) until you choose a user | Seerr API-key account |
| TV seasons | all seasons (same as upstream) | all seasons |
| Manual auto-request run | asks for confirmation | runs immediately |

To get upstream's selection behaviour, choose **Missing-first** for movies and series.

### Prerequisites

- A working Aperture setup (Emby or Jellyfin, PostgreSQL with pgvector, OpenAI or another provider) as in upstream.
- **Seerr** configured in Aperture, with an **admin** API key (Seerr only honours a requesting user from an admin key).
- A **TMDB API key** for the genre, keyword, country and release-date filters. Without it those filters cannot be evaluated, and titles that need them are never requested.

### Limitations

- The fork's container image is built for **linux/amd64 only**, unlike upstream's multi-architecture images. On ARM hosts build from source.
- Independently maintained and best effort; it only tracks upstream occasionally. Do not expect upstream support for fork features.
- Tested with unit and integration tests in CI (mock Seerr and TMDB) and on the maintainer's own server. Not tested against every Emby/Jellyfin/Seerr combination.
- The new screens are **English only**; other languages fall back to English for these strings.
- MDBList lists carry no language or release-date data, so those checks use a TMDB lookup per title (cached); the existing language filter does not apply to MDBList lists.
- Filters use TMDB data: a title TMDB cannot describe is shown as *uncertain* and is never requested.
- The skipped-titles list and the rules are stored per media type in the database; the confirmation dialogs were verified by type checks and API tests, not by a browser test suite.
- **Rollback is not just "start the old image"**: older builds ignore or reject newer rules and would request without your filters. Read [docs/fork/upgrading-and-rollback.md](docs/fork/upgrading-and-rollback.md) before downgrading.

---

## Quick Start (build from source)

Building from source works on any architecture. It needs Docker with Compose and about 4 GB of free RAM while building. (To use the prebuilt image instead, see the next section.)

```bash
git clone https://github.com/avalynnrose/aperture.git
cd aperture
git checkout v0.7.10-fork.5           # an exact release tag; see docs/fork/releases.md
cp docker-compose.fork.yml docker-compose.local.yml
```

1. Edit `docker-compose.local.yml` and set:
   - `APP_BASE_URL` — the address you will open Aperture at (e.g. `http://YOUR_SERVER_IP:3456`)
   - `SESSION_SECRET` — a random string of 32+ characters (keep the quotes)
   - the three volume paths — see the comments in the file; the same guidance applies as in upstream's `docker-compose.prod.yml`
2. Create the host folders you mapped (an `ApertureLibraries` folder inside your media share and a backups folder).
3. Build and start:

```bash
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up -d
```

4. Open `http://YOUR_SERVER_IP:3456` and complete the setup wizard (below), then log in with your Emby/Jellyfin admin account.


### Setup wizard

The wizard has 11 steps: **Restore** (optional), **Media Server**, **Source Libraries**, **File Locations**, **AI Recommendations**, **Validate**, **Users**, **Top Picks** (optional), **AI / LLM**, **Initial Jobs**, **Complete**. Upstream's [Admin Guide](docs/admin-guide.md) walks through them. Platform-specific volume notes for Unraid, QNAP, Synology and Windows are in upstream's compose files and guides (for example [docs/admin/windows-docker-desktop.md](docs/admin/windows-docker-desktop.md)); they apply here too, but use `docker-compose.fork.yml` as the starting point so that the fork is built.

### Using the fork's published image

Versioned images are published to GitHub Container Registry, built only from release tags by a manual, owner-approved workflow, and are **publicly pullable** (linux/amd64 only; on other architectures build from source). There is deliberately **no `latest` tag**: pin an exact release tag.

```bash
docker pull ghcr.io/avalynnrose/aperture:v0.7.10-fork.5
```

[docker-compose.fork-image.example.yml](docker-compose.fork-image.example.yml) is a complete compose file that uses the image; set `APP_BASE_URL`, `SESSION_SECRET` and the volume paths as described above. Versioning and release rules: [docs/fork/releases.md](docs/fork/releases.md).

### Updating

```bash
git fetch --tags && git checkout <new release tag>
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up -d
```

Back up the database first and read [docs/fork/upgrading-and-rollback.md](docs/fork/upgrading-and-rollback.md).

---

## Features

### AI Recommendations

- **Personalized Libraries** — Creates dedicated "AI Picks" libraries for each user
- **OpenAI Embeddings** — Semantic vectors for all your media
- **pgvector Similarity** — Lightning-fast vector similarity search
- **Configurable Algorithm** — Tune weights for similarity, novelty, rating, and diversity

### Media Support

- **Movies** — Full movie library sync with metadata, ratings, and watch history
- **TV Series** — Complete series and episode tracking with per-show recommendations
- **Watch History** — Automatic sync of viewing history including play counts and favorites

### Rating System

- **10-Heart Ratings** — Rate content from 1-10 hearts (Trakt.tv compatible)
- **Rate from Any Poster** — Click the heart icon on any poster
- **Trakt.tv Sync** — Bidirectional sync of ratings with Trakt

### Personalization

- **AI Taste Profiles** — Natural language descriptions of user preferences
- **Match Scores** — Personalized percentage scores showing recommendation fit
- **Recommendation Insights** — Detailed breakdown of why each title was recommended

### Top Picks (Global)

- **Popularity-Based Content** — Trending content across all users
- **Multiple Output Modes** — Libraries, Collections, and/or Playlists
- **Rank Badges** — Gold, silver, bronze badges for top 3 on posters

### Symlinks & Artwork

- **Full Artwork Preservation** — Symlinks banner.jpg, clearlogo.png, landscape.jpg, and more
- **Smart Subtitle Handling** — Subtitles are symlinked and renamed to match video files
- **Custom NFOs** — Aperture generates NFOs with AI explanations while preserving original artwork

### Backup & Restore

- **Automatic Daily Backups** — Database backed up at 1 AM (configurable)
- **Restore During Setup** — Restore from backup when setting up a new instance
- **Admin Panel Restore** — Restore from the Admin → Settings → System tab
- **Configurable Retention** — Set how many backups to keep

### Admin Features

- **Setup Wizard** — Guided first-time configuration
- **Job Management** — Real-time progress, scheduling, and history
- **Configurable Schedules** — All job schedules adjustable via Admin → Jobs
- **User Management** — Per-user recommendation settings
- **Cost Estimator** — Built-in OpenAI API cost estimation

---

## Fork Changes

Changes in this fork relative to upstream `v0.7.10`. Apart from the default selection strategy for automatic requests (see [Defaults](#defaults-and-how-they-differ-from-upstream)), everything defaults to upstream behavior. Dated history: [NOTICE](NOTICE).

### Top Picks Requester (Settings → Top Picks → Auto-Request)

Choose which Seerr user account is credited with automatic Top Picks requests, for movies and TV alike.

- **Where:** a dropdown labelled **Top Picks Requester**, listing Seerr users by name (not numeric ID). Aperture stores the selected user's Seerr ID.
- **Default:** *Default (Seerr API key account)*. No user is sent with the request, which is the upstream behavior.
- **Scope:** automatic Top Picks requests only. Manual and Discover requests are unchanged.
- **Deleted or unavailable users:** the saved selection is never switched silently. If the selected user no longer exists, the dropdown shows *Unavailable user (ID n)* with a warning, and the auto-request job stops with an error in its log until you choose another account or Default. If Seerr cannot be reached or returns no users, the job also stops rather than guessing.
- **Requirements:** Seerr must be configured, and its API key must belong to an admin (Seerr only honors a requesting user ID from an admin key).
- **Admin API:** `GET /api/seerr/users` (admin only) returns `{ users: [{ id, name }] }`; emails and tokens are not included.

### Auto-request rules (Settings → Top Picks → Auto-Request)

Choose *which* missing titles are requested automatically. Details: [docs/admin/auto-request-rules.md](docs/admin/auto-request-rules.md).

- **Strategies:** **Top N Eligible** (default: a chart of the first *N* ranked titles that pass your filters; owned and already-requested titles hold their place without a new request, excluded and unreleased titles take none), *Missing-first* (the upstream behavior), **Strict Top N**, **Fill to N**; separate settings and target count for movies and TV, plus the existing per-run maximum as an independent safety cap.
- **Ranking:** external list order (default) or the hybrid blend the Top Picks display uses (hybrid sources only).
- **Filters:** country of origin (include or exclude), TMDB genres, TMDB keywords, an optional *skip unreleased titles* switch, alongside the existing language filter. Failed or empty metadata is never silently treated as a match.
- **Skip single titles:** a ✕ in the preview removes one title from automatic requests (saved per media type, undoable) and the next eligible title fills its place.
- **Preview:** a read-only table of the ranked candidates with original rank, status, filter matches and reasons, built by the same code as the real run. Manual runs ask for confirmation.
- **Defaults:** the filters and the unreleased switch are off until you turn them on; the default strategy is Top N Eligible, and *Missing-first* restores upstream behavior.

### TV season selection (Settings → Top Picks → Auto-Request → Series)

Choose which seasons automatic TV requests ask for. This is independent of the requester setting.

- **All seasons (default):** upstream behavior.
- **Season 1 only:** requests only the first season of each show.

### Healthcheck

The container healthcheck uses `http://127.0.0.1:3456/health` instead of `localhost`, which can resolve to IPv6 on hosts where the server listens on IPv4 only.

### Database

All changes are additive: older images keep running against a migrated database.

| Migration | Release | Adds |
| --- | --- | --- |
| `0115_top_picks_requester_and_seasons.sql` | fork.1 | `auto_request_seerr_user_id` and `series_auto_request_seasons` on `top_picks_config` |
| `0116_auto_request_rules.sql` | fork.2 | `movies_auto_request_rules` and `series_auto_request_rules` (JSON) on `top_picks_config` |

fork.3 and fork.4 need no migration: the Top N Eligible strategy, the skip-unreleased switch and the skipped-titles list live inside the JSON from `0116`.

---

## Default Job Schedules

All schedules are configurable in **Admin → Jobs**.

| Job                 | Default Schedule         |
| ------------------- | ------------------------ |
| Database Backup     | Daily at 1 AM            |
| Library Scan        | Daily at 2 AM            |
| Embeddings          | Daily at 3 AM            |
| AI Recommendations  | Weekly on Sunday at 4 AM |
| Top Picks           | Daily at 5 AM            |
| Watch History       | Every 2 hours            |
| Metadata Enrichment | Every 6 hours            |

---

## Documentation

| Guide                                  | Description                                                  |
| -------------------------------------- | ------------------------------------------------------------ |
| [Admin Guide](docs/admin-guide.md)     | Setup walkthrough, job management, algorithm tuning          |
| [User Guide](docs/user-guide.md)       | Features for end users, ratings, channels                    |
| [Configuration](docs/configuration.md) | Volume setup, reverse proxy, Trakt integration               |
| [API Reference](docs/api-reference.md) | Complete API endpoint documentation                          |
| [Architecture](docs/architecture.md)   | Technical overview, recommendation pipeline, database schema |
| [Development](docs/development.md)     | Local dev setup, scripts, contribution guidelines            |
| [Fork: auto-request rules](docs/admin/auto-request-rules.md) | Strategies, filters, preview, skipping titles (fork feature) |
| [Fork: releases](docs/fork/releases.md) | Version tags, image status, versioning rules (fork)        |
| [Fork: upgrading and rolling back](docs/fork/upgrading-and-rollback.md) | Migrations and safe rollback (fork)            |
| [NOTICE](NOTICE)                       | Modifications relative to upstream, with dates and source link |

---

## Tech Stack

- **Backend**: Fastify, TypeScript, PostgreSQL, pgvector
- **Frontend**: React, Vite, MUI, React Router
- **AI**: OpenAI Embeddings & GPT models
- **Infrastructure**: Docker, pnpm workspaces

---

## License and notices

Aperture and this fork are licensed under the [GNU Affero General Public License v3.0](LICENSE). This is a **modified version** of Aperture; the modifications and their dates are listed in [NOTICE](NOTICE). The application links to this repository's source code (sign-in page and sidebar), as AGPL-3.0 section 13 requires for network use. If you modify and run this software for others, publish your modified source and point that link at it (`apps/web/src/components/SourceLink.tsx`).

"Aperture" and its original design belong to the upstream project; this fork is not affiliated with it.
