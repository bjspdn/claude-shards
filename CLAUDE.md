## Knowledge Index
Use MCP tool `read` with the note path to fetch full details on demand.
🔴 = gotchas  🟤 = decisions  🔵 = patterns  🟢 = references

| T  | Title                                     | Path                                         | ~Tok |
|----|-------------------------------------------|----------------------------------------------|------|
| 🟢 | ccm Git Workflow                          | references/ccm-git-workflow.md               | ~340 |

## Conventions:
- Name functions with a clear verb-first pattern that describes what they do (e.g., `fetchUsers`, `validateInput`, `calculateTotal`). For event handlers, use the `on{Event}` prefix (e.g., `onClick`, `onSubmit`). Avoid vague names like `handleData`, `processStuff`, or single-word names like `update`.

### Versioning
The `commit-msg` hook validates conventional commit format. Version bumps happen automatically in the release workflow when `dev` merges to `master`:
  - `feat: ...` → **MINOR** bump
  - `fix: ...` / `refactor: ...` / etc → **PATCH** bump
  - **MAJOR** bumps are reserved — only bump manually when explicitly told to.

Do not manually edit the version in `package.json`.

### Branching
- `master` — protected, releases only via PR from `dev`. Merging auto-tags and publishes to npm.
- `dev` — protected, integration branch. Owner merges `dev` → `master` for releases.
- Contributors create feature branches off `dev`, then PR back to `dev` (requires owner approval).

### Changelog
When creating a PR to `dev`, add entries to `CHANGELOG.md` under the `## Unreleased` heading. The release workflow automatically replaces `## Unreleased` with the actual version number when `dev` merges to `master`. Keep bullet points concise and user-facing — focus on what the end user gains, not implementation details.