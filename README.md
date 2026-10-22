# Aperture

[![Version](https://img.shields.io/badge/version-0.7.10-blue.svg)](https://github.com/dgruhin-hrizn/aperture/releases)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fdgruhin--hrizn%2Faperture-blue?logo=docker)](https://github.com/dgruhin-hrizn/aperture/pkgs/container/aperture)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

> ## Personal Fork
>
> This is a personal fork of Aperture maintained primarily for my own homelab.
>
> It includes experimental enhancements to automatic Seerr requests, including configurable content filters and selection strategies.
>
> This fork is not officially affiliated with or supported by the original Aperture project. Updates and support are provided on a best-effort basis.
>
> Upstream project: [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture) (AGPL-3.0; see [LICENSE](LICENSE)). Fork changes are listed in [Fork Changes](#fork-changes).
>
> Released images are built from tagged commits of this repository (for example `v0.7.10-fork.1`); the tag identifies the exact corresponding source.

**Aperture** — AI-powered media recommendations for Emby & Jellyfin.

Aperture creates personalized recommendation libraries for your media server users using OpenAI embeddings and pgvector similarity search. Recommendations appear as virtual libraries in your media server's home screen, with support for both **movies** and **TV series**.

---

## Quick Start

### 1. Download the docker-compose file for your platform

| Platform        | File                          | Download                                                                                               |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Unraid**      | `docker-compose.unraid.yml`   | [Download](https://raw.githubusercontent.com/dgruhin-hrizn/aperture/main/docker-compose.unraid.yml)    |
| **QNAP**        | `docker-compose.qnap.yml`     | [Download](https://raw.githubusercontent.com/dgruhin-hrizn/aperture/main/docker-compose.qnap.yml)      |
| **Synology**    | `docker-compose.synology.yml` | [Download](https://raw.githubusercontent.com/dgruhin-hrizn/aperture/main/docker-compose.synology.yml)  |
| **Windows**     | `docker-compose.windows.yml`  | [Download](https://raw.githubusercontent.com/dgruhin-hrizn/aperture/main/docker-compose.windows.yml) ¹ |
| **Linux/Other** | `docker-compose.prod.yml`     | [Download](https://raw.githubusercontent.com/dgruhin-hrizn/aperture/main/docker-compose.prod.yml)      |

> ¹ **Windows Users**: For Docker Desktop with Emby/Jellyfin running natively on Windows, see the [complete setup guide](docs/admin/windows-docker-desktop.md).

### 2. Configure the file

Edit the docker-compose file and set:

- `APP_BASE_URL` — Your server's IP address (e.g., `http://192.168.1.100:3456`)
- `SESSION_SECRET` — A random string (32+ characters)
- Volume paths — Adjust to match your media folder locations

### 3. Create required folders

```bash
# Example for Unraid - adjust paths for your platform
mkdir -p /mnt/user/Media/ApertureLibraries
mkdir -p /mnt/user/appdata/aperture/backups
```

### 4. Start Aperture

```bash
docker-compose -f docker-compose.[your-platform].yml up -d
```

### 5. Complete the Setup Wizard

Open `http://YOUR_SERVER_IP:3456` and follow the 11-step guided setup:

1. **Restore** (Optional) — Restore from an existing backup if migrating
2. **Media Server** — Connect to your Emby/Jellyfin server
3. **Source Libraries** — Select which libraries to analyze
4. **File Locations** — Configure path mappings for symlinks/STRM
5. **AI Recommendations** — Configure library naming and cover images
6. **Validate** — Verify output configuration and paths
7. **Users** — Select which users receive recommendations
8. **Top Picks** (Optional) — Configure global trending libraries
9. **AI / LLM** — Enter your OpenAI API key (or configure Ollama/other providers)
10. **Initial Jobs** — Run first-time sync with real-time progress
11. **Complete** — Review summary and next steps

### 6. Log in

Use your Emby/Jellyfin admin credentials to access Aperture.

---

## Updating

```bash
docker-compose -f docker-compose.[your-platform].yml pull
docker-compose -f docker-compose.[your-platform].yml up -d
```

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

Changes in this fork relative to upstream `v0.7.10`. Everything below defaults to upstream behavior, so an unmodified install behaves exactly as upstream until you change a setting.

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

- **Strategies:** *Missing-first* (default, unchanged behavior), **Strict Top N**, **Fill to N**; separate settings and target count for movies and TV, plus the existing per-run maximum as an independent safety cap.
- **Ranking:** external list order (default) or the hybrid blend the Top Picks display uses (hybrid sources only).
- **Filters:** country of origin (include or exclude), TMDB genres, TMDB keywords, alongside the existing language filter. Failed or empty metadata is never silently treated as a match.
- **Preview:** a read-only table of the ranked candidates with original rank, status, filter matches and reasons, built by the same code as the real run. Manual runs ask for confirmation.
- **Defaults:** every rule is off or set to upstream behavior until you change it.

### TV season selection (Settings → Top Picks → Auto-Request → Series)

Choose which seasons automatic TV requests ask for. This is independent of the requester setting.

- **All seasons (default):** upstream behavior.
- **Season 1 only:** requests only the first season of each show.

### Healthcheck

The container healthcheck uses `http://127.0.0.1:3456/health` instead of `localhost`, which can resolve to IPv6 on hosts where the server listens on IPv4 only.

### Database

Migration `0115_top_picks_requester_and_seasons.sql` adds two columns to `top_picks_config` (`auto_request_seerr_user_id`, `series_auto_request_seasons`). It is additive, so earlier images continue to run against the migrated database.

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

---

## Tech Stack

- **Backend**: Fastify, TypeScript, PostgreSQL, pgvector
- **Frontend**: React, Vite, MUI, React Router
- **AI**: OpenAI Embeddings & GPT models
- **Infrastructure**: Docker, pnpm workspaces

---

## License

[GNU Affero General Public License v3.0](LICENSE)
