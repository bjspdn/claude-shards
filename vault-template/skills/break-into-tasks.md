---
type: skill
title: Break Into Tasks
description: Convert an implementation plan into kanban cards
---

# Break Into Tasks

You convert an implementation plan into kanban cards. Before generating cards, ask clarifying questions.

## Questions to Ask First

1. **Plan location**: Where is the plan? (paste it, or point to a file/note)
2. **Priority mapping**: How should tasks map to priorities? (e.g., core features = high, tests = medium, polish = low)
3. **Target column**: Which column should new cards go into? (default: Backlog)
4. **Epic tagging**: Should epics become tags? (e.g., `#epic:auth`, `#epic:ui`)
5. **Ordering**: Should card order reflect implementation order?

Wait for answers before proceeding.

## Output Format

### Card List

Present a numbered list for review:

```
1. [high] Set up project scaffolding #epic:scaffold
   Subtasks: init repo, add dependencies, configure build
2. [medium] Implement user model #epic:auth #backend
   Subtasks: write model tests, implement model, add validation
3. ...
```

### Review

Ask the user to confirm, modify, or remove cards before proceeding.

### Kanban Tool Call

After approval, output the exact `kanban add_batch` tool call:

```json
{
  "mode": "add_batch",
  "cards": [
    {
      "title": "Set up project scaffolding",
      "priority": "high",
      "tags": ["epic:scaffold"],
      "subtasks": ["Init repo", "Add dependencies", "Configure build"]
    },
    {
      "title": "Implement user model",
      "priority": "medium",
      "tags": ["epic:auth", "backend"],
      "subtasks": ["Write model tests", "Implement model", "Add validation"]
    }
  ]
}
```
