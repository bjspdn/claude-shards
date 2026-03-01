### Changelog
PRs to `dev` must update `CHANGELOG.md` under `## Unreleased`. CI enforces this.

### Releasing
Run `bun run prepare-release` on `dev` before merging to `master`. The script bumps the version, replaces `## Unreleased` with the version number, adds a fresh `## Unreleased` heading, and commits. The release workflow then tags and publishes automatically on merge.