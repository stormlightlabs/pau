---
description: Review the dirty working tree without editing it
argument-hint: [focus]
---

Review the current dirty working tree. Focus on `${@:-all changed behavior}`.
Do not edit reviewed files.

Read `AGENTS.md` and the active unit in its deliverable file linked from
`dev/ROADMAP.md`. Read `dev/SPEC.md`, `dev/PLAN.md`, and every document they
link before reviewing the project. Use those indexes to identify the documents
governing the changed behavior. Inspect staged and unstaged diffs, relevant
untracked files, surrounding code, callers, tests, and documentation. Research
dependency or platform behavior when a finding depends on it. Run focused
read-only checks when they can confirm or reject a suspected defect.

Review correctness, edge cases, security, concurrency, process cleanup,
compatibility, test quality, documentation, and needless complexity. Report only
actionable findings with a concrete failing input or state. Group repeated
causes and omit taste-only comments.

Use one line per finding, most severe first:

`<blocker|high|medium|low|nit> · <path>:<line> — <problem> → <impact> → <fix direction>`

Keep the report under 200 words. If nothing actionable remains, return
`No findings.`
