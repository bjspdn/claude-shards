---
type: decisions
projects:
  - bevy-game
tags:
  - bevy
  - architecture
created: 2026-01-10
updated: 2026-01-10
---

# Chose ECS over OOP for game architecture

ECS gives better cache performance and composability. Inheritance hierarchies become rigid and hard to refactor. Bevy's ECS is idiomatic Rust.
