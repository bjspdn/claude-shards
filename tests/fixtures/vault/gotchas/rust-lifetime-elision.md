---
type: gotcha
projects:
  - shared
tags:
  - rust
created: 2026-01-15
updated: 2026-01-15
---

# Rust lifetime elision can surprise you

When a function takes multiple references, the compiler can't always infer lifetimes. Explicitly annotate when the return borrows from a specific parameter.
