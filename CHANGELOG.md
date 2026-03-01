## Unreleased

- Add `prepare-release` script to bump version and changelog on `dev` before merging to `master`
- Simplify release workflow to tag + publish only (no more commits on `master`)
- Add `release-ready` CI check on PRs to `master` to catch missing version bumps

## 0.14.0

- CI now enforces changelog updates on PRs to `dev`
- Fix release workflow failing to push version bump to protected `master`

## 0.13.0

- Write tool now supports `append` and `patch` modes for incremental note updates without rewriting the entire file
- New `section` parameter for `patch` mode — replace a single section by its heading
- Legacy `overwrite` parameter still works but is deprecated in favor of `mode: "replace"`
- JSDoc on all exported tool functions
- Real-time file sync — vault changes in Obsidian, or editors are picked up automatically
- Diagnostics MCP tool for runtime health (vault stats, watcher activity, process metrics)
- Update notifier in MCP tool responses and CLI help
- Fix update notifier race condition — changelog now reliably appears when a new version is available

## 0.11.0

- Global `ccm` binary with `--init`, `--update`, `--uninstall`, `--version` flags
- MCP server runs via global install instead of bunx

## 0.10.0

- `--version` and `--update` CLI flags
- Pre-commit hook for tests and build

## 0.9.10

- Plural note type directory names (gotchas/, decisions/, patterns/, references/)
