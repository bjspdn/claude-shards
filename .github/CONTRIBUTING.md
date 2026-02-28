# Contributing to claude-code-memory

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh/) (runtime and package manager)
- [Node.js](https://nodejs.org/) 22+ (used by husky hooks)

## Setup

```bash
git clone https://github.com/Ben-Spn/claude-code-memory.git
cd claude-code-memory
bun install
```

This installs dependencies and sets up husky git hooks automatically.

## Branching Model

```
feature-branch → dev → master
```

- **`master`** — protected, releases only. Merging to `master` auto-tags and publishes to npm.
- **`dev`** — protected, integration branch. All contributions target this branch.
- **Feature branches** — create from `dev`, PR back to `dev`.

### Workflow

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature

# make changes, commit, push
git push -u origin feat/your-feature
```

Then open a PR targeting `dev`. PRs require:
- CI build passing
- Owner approval (stale reviews are dismissed on new pushes)

## Commit Messages

All commits must use [Conventional Commits](https://www.conventionalcommits.org/) format. This is enforced by a husky `commit-msg` hook.

| Prefix      | Version Bump | Use for                                    |
|-------------|--------------|--------------------------------------------|
| `feat:`     | minor        | New features, new tools, new capabilities  |
| `fix:`      | patch        | Bug fixes                                  |
| `refactor:` | patch        | Code restructuring without behavior change |
| `perf:`     | patch        | Performance improvements                   |
| `test:`     | patch        | Adding or updating tests                   |
| `docs:`     | patch        | Documentation changes                      |
| `ci:`       | patch        | CI/CD changes                              |
| `chore:`    | patch        | Maintenance tasks                          |
| `build:`    | patch        | Build system changes                       |
| `style:`    | patch        | Code style/formatting                      |

Version bumps are handled automatically — you don't need to touch `package.json` manually.

### Examples

```
feat: add tag filtering to search tool
fix: handle empty vault on first sync
refactor: extract markdown parser into utility
docs: add API examples to README
```

Scoped prefixes are also accepted: `feat(search): add fuzzy matching`

## Code Conventions

- **Function names** — verb-first pattern describing what they do (e.g., `fetchUsers`, `validateInput`, `calculateTotal`)
- **Event handlers** — use `on{Event}` prefix (e.g., `onClick`, `onSubmit`)
- **No vague names** — avoid `handleData`, `processStuff`, or single-word names like `update`

## Building

```bash
bun run build
```

Output goes to `dist/`. The bundler ([bunup](https://github.com/nicepkg/bunup)) inlines imports like `package.json` at build time.

## Questions?

Open an [issue](https://github.com/Ben-Spn/claude-code-memory/issues) if something is unclear.
