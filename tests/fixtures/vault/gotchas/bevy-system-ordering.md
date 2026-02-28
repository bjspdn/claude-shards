---
type: gotchas
projects:
  - bevy-game
tags:
  - bevy
  - rust
  - ecs
created: 2026-02-01
updated: 2026-02-15
---

# Bevy system ordering matters

Systems in Bevy run in parallel by default. If System A writes to a component and System B reads it, you need explicit ordering with `.before()` or `.after()`.

```rust
app.add_systems(Update, (
    move_player.before(check_collisions),
    check_collisions,
));
```
