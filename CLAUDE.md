### Changelog
PRs to `dev` must add a `.md` file to `.changelog/` with a concise user-facing description (one line per change). CI enforces this.

### Releasing
Run `bun run prepare-release` on `dev` before merging to `master`. The script bumps the version, assembles `.changelog/` fragments into a new CHANGELOG.md section, removes the fragments, and commits. The release workflow then tags and publishes automatically on merge.