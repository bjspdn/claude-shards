## Conventions:
- Name functions with a clear verb-first pattern that describes what they do (e.g., `fetchUsers`, `validateInput`, `calculateTotal`). For event handlers, use the `on{Event}` prefix (e.g., `onClick`, `onSubmit`). Avoid vague names like `handleData`, `processStuff`, or single-word names like `update`.

### Versioning
Version bumps are handled automatically by the husky `commit-msg` hook on every commit. Use conventional commit prefixes:
  - `feat: ...` → **MINOR** bump
  - `fix: ...` / `refactor: ...` / etc → **PATCH** bump
  - **MAJOR** bumps are reserved — only bump manually when explicitly told to.

### Branching
- `master` — protected, releases only via PR from `dev`. Merging auto-tags and publishes to npm.
- `dev` — protected, integration branch. Owner merges `dev` → `master` for releases.
- Contributors create feature branches off `dev`, then PR back to `dev` (requires owner approval).