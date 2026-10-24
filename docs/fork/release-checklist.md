# Release checklist (fork)

Follow this for every release so the same decisions are not revisited. A release is a tag
`v<upstream version>-fork.<N>` on a commit of `main`.

## Decisions already made (do not reopen without a reason)

- Tags are immutable annotated tags; images are published only for tags; there is **no `latest`**.
- Publishing is manual and needs the owner's approval at the `ghcr-publish` environment. Never
  approve it on someone else's behalf and never add a trigger that publishes automatically.
- The disabled upstream workflow `docker-build.yml` stays (a maintainer script still references it).
- Published images are linux/amd64 only; ARM users build from source.
- Build dependencies (for example the Alpine `postgresql17-client` package) are not version-pinned.
  Revisit only if a rebuild actually breaks.
- Top N Eligible stays the default strategy; the README documents how it differs from upstream.
- Git history and author names are never rewritten; `main` only blocks force pushes and deletion.
- Deploying a release anywhere is a separate step from publishing it.

## Steps

1. **Prepare** on a branch: code or docs changes, `NOTICE` (dated entry), release notes
   `docs/fork/release-notes/<tag>.md`, and every place that names the current tag (README quick
   start, `docker-compose.fork.yml`, `docker-compose.fork-image.example.yml`).
2. **CI**: open a PR; "CI checks (fork)" must pass (tests, type check, lint, build, migration replay,
   integration tests, private-content guard). Merge with a **merge commit**.
3. **Test image**: run the manual workflow "Build test image (no publishing)" on `main`
   (label `<tag>-rc`). Download the artifact, verify its checksum and that its revision label equals
   the commit to be tagged.
4. **Staging** (disposable, own network, memory-capped, mock Seerr and TMDB, no real keys): upgrade
   from the previous release on the same database, confirm migrations (none, or the expected ones),
   that settings and the default behaviour are unchanged, and exercise any new feature. Remove it
   afterwards.
5. **Security scan**: run the guard patterns over the diff since the previous tag (private
   addresses, emails, tokens, key blocks), and check the image for environment secrets and stray files.
6. **Tag**: confirm the tree of the commit to tag is identical to the tested commit
   (`git diff --stat <tested> <commit>` is empty), then create the annotated tag and push it.
7. **Publish**: start "Publish fork image (manual)" from the tag with `version=<tag>` and
   `confirm=publish`; the owner approves the `ghcr-publish` gate.
8. **Verify the published image**: labels (source, revision, version), runs as a non-root user, files
   identical to the tested image (compare `apps/*/dist`, `packages/core/dist`, `db`, `package.json`
   with `LC_ALL=C sort`), and an anonymous pull works.
9. **GitHub Release**: create the release from the tag with the notes file (installation, changes
   since upstream, known limitations), as a draft first, then publish it.
10. **Deploy** (maintainer only, separate approval): back up the database, deploy, verify, keep the
    previous container for rollback. Follow [upgrading-and-rollback.md](upgrading-and-rollback.md)
    for any release that changes stored settings.
11. **Record** the release in the maintainer's own runbook.

## Package visibility

The package was made public after fork.5 (2026-10-23) and stays public; it is linked to this
repository. Making a package public makes all its versions public, so never publish an image that
contains anything private. After each release, confirm an anonymous pull works
(`DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/avalynnrose/aperture:<tag>`).
