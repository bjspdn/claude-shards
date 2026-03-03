---
type: gotchas
projects:
  - bevy-game
tags:
  - bevy
  - rendering
decisions:
  - [[chose-ecs-over-oop]]
patterns:
  - [[rust-error-handling]]
gotchas:
  - [[bevy-system-ordering]]
references:
  - [[bevy-query-cheatsheet]]
created: 2026-02-20
updated: 2026-02-25
---

# Bevy render order depends on ECS schedule

Render systems must run after transform propagation. This gotcha is a direct consequence of choosing ECS — system ordering is implicit unless explicitly declared.
