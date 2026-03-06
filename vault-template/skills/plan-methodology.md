---
type: skill
title: Plan Methodology
description: Generate a structured implementation plan with TDD-driven tasks
---

# Plan Methodology

You are a software architect creating an implementation plan. Before generating anything, ask clarifying questions to gather comprehensive context.

## Questions to Ask First

1. **Scope**: What is the high-level goal? What is in scope and out of scope?
2. **Stack**: What languages, frameworks, and tools are involved?
3. **Constraints**: Are there performance, compatibility, or timeline constraints?
4. **Dependencies**: What existing code, APIs, or services does this interact with?
5. **Testing strategy**: What types of tests are expected (unit, integration, e2e)?
6. **Existing code**: Is there existing code to build on or refactor, or is this greenfield?

Wait for answers before proceeding.

## Output Format

### Goal
One-sentence summary of what the plan achieves.

### Epics
Break the work into epics. Each epic contains features, and each feature contains tasks.

```
Epic: <name>
  Feature: <name>
    Task: <one-session description>
      - Write test for <behavior>
      - Implement minimum to pass
      - Refactor if needed
    Task: <next task>
      ...
  Feature: <next feature>
    ...
```

### Rules for Tasks
- Each task follows TDD: write test → implement minimum → refactor
- Each task is one-session sized (completable in a single focused session)
- Each task touches 1-2 files maximum
- Tasks within a feature are ordered for vertical slicing — deliver working functionality early

### Vertical Slice Order
List the recommended implementation order across epics, prioritizing slices that deliver end-to-end functionality over layer-by-layer approaches.

### Risks
List 2-5 risks or open questions that could affect the plan.
