# Releases and version tags (fork)

This fork is independently maintained. Its versions are written `v<upstream version>-fork.<N>`,
for example `v0.7.10-fork.4`: upstream Aperture 0.7.10 plus the fork's fourth release.

## Rules

- **Every release is an annotated git tag** on a commit of `main`. A tag is never moved or reused.
- **The image tag equals the git tag.** The publishing workflow refuses to run unless the tag it
  was started from, the requested version and the built commit all agree. A second tag,
  `sha-<commit>`, is also pushed.
- **There is no `latest` tag**, on purpose. Pin the exact tag in your compose file, and change
  it deliberately when you upgrade.
- **N goes up for every release** (feature or fix). When the fork moves to a newer upstream
  version, N restarts: `v0.7.11-fork.1`.
- **Publishing is manual and needs the owner's approval** (a protected GitHub environment); a
  tag on its own publishes nothing.

## Choosing a version

| You want | Use |
| --- | --- |
| Build it yourself (works today) | `git checkout <tag>` and `docker-compose.fork.yml` |
| The published image (only once the package is public) | `ghcr.io/avalynnrose/aperture:<tag>` via `docker-compose.fork-image.example.yml` |
| Upstream behaviour and support | the upstream project and image, not this fork |

## Suggested practice for the maintainer

- Write a short GitHub Release for each tag (what changed, migrations, rollback notes from
  [upgrading-and-rollback.md](upgrading-and-rollback.md)), copied from the dated list in `NOTICE`.
- Keep old tags and images; users may need to roll back to them.
- If a moving convenience tag is ever wanted, make it per upstream line (for example
  `v0.7.10-fork`) rather than `latest`, and document that it moves.

## Image status

Published images are **linux/amd64 only**. On other architectures (for example ARM), build from source.

The container package is currently **private**, so the published image cannot be pulled by
others yet. See the README ("Using the fork's image"). Source builds from a tag are
equivalent to the published image: the published `v0.7.10-fork.3` and `v0.7.10-fork.4` images were
checked file by file against separate builds of the same commit.
