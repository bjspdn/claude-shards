## 0.14.0

- Write tool now supports `append` and `patch` modes for incremental note updates without rewriting the entire file
- New `section` parameter for `patch` mode — replace a single section by its heading
- Legacy `overwrite` parameter still works but is deprecated in favor of `mode: "replace"`
- JSDoc on all exported tool functions

## 0.13.0

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
