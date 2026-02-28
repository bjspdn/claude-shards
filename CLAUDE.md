## Conventions:
- Name functions with a clear verb-first pattern that describes what they do (e.g., `fetchUsers`, `validateInput`, `calculateTotal`). For event handlers, use the `on{Event}` prefix (e.g., `onClick`, `onSubmit`). Avoid vague names like `handleData`, `processStuff`, or single-word names like `update`.

### Versioning
Version bumps are handled automatically by the husky `commit-msg` hook on every commit. Use conventional commit prefixes:
  - `feat: ...` → **MINOR** bump
  - `fix: ...` / `refactor: ...` / etc → **PATCH** bump
  - **MAJOR** bumps are reserved — only bump manually when explicitly told to.

### Branching
- `master` — protected, releases only via PR merge
- `dev` — working branch for local development
- Feature branches off `dev` for contributors