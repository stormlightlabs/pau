---
description: Implement one ready roadmap unit
argument-hint: <unit-id>
---

Implement roadmap unit `$1`.

Read `AGENTS.md`, then the unit and its owning sections in `dev/ROADMAP.md`, `dev/SPEC.md`, and `dev/PLAN.md`. Stop if the ID is missing, the unit is not `planned` or `in progress`, or any blocker is not `complete`.

Before editing, set a `planned` unit to `in progress`. Trace the affected code and reuse established libraries and patterns. Implement only the unit's stated scope, including its tests, Storybook stories, and documentation. Preserve unrelated dirty-tree changes.

Run the unit's verification, starting with focused checks. Perform its dogfood step when required. Set the unit to `complete` only when verification passes. If work cannot continue, set it to `blocked` and add a concise `Status note` with the concrete reason.

Report what changed, checks run, anything not verified, and any separate follow-up discovered. Do not expand this unit to fix unrelated findings.
