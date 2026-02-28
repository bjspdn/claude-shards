## Conventions:
- Name functions with a clear verb-first pattern that describes what they do (e.g., `fetchUsers`, `validateInput`, `calculateTotal`). For event handlers, use the `on{Event}` prefix (e.g., `onClick`, `onSubmit`). Avoid vague names like `handleData`, `processStuff`, or single-word names like `update`.

### Versioning
After completing any changes, read the `src/index.ts` file then bump the version in the `McpServer` constructor call. Once per task, not per individual edit.
  - **MAJOR** (`X.0.0`): Reserved — only bump when explicitly told to. Used for milestone features (e.g., agent orchestration, LLM semantic search).
  - **MINOR** (`x.X.0`): New features, new tools, new capabilities.
  - **PATCH** (`x.x.X`): Bug fixes, refactors, non-breaking changes.