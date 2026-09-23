---
description: Review the dirty working tree without editing it
argument-hint: [focus]
---

Review the current dirty working tree. Focus on `${@:-all changed behavior}`.
Do not edit reviewed files.

Read `AGENTS.md` and the active unit in `dev/ROADMAP.md`. Inspect staged and
unstaged diffs, relevant untracked files, surrounding code, callers, tests, and
documentation. Research dependency or platform behavior when a finding depends
on it. Run focused read-only checks when they can confirm or reject a suspected
defect.

Review correctness, edge cases, security, concurrency, process cleanup,
compatibility, test quality, documentation, and needless complexity. Report only
actionable findings with a concrete failing input or state. Group repeated
causes and omit taste-only comments.

Use one line per finding, most severe first:

`<blocker|high|medium|low|nit> · <path>:<line> — <problem> → <impact> → <fix direction>`

Keep the report under 200 words. If nothing actionable remains, return
`No findings.`

Treat direct user corrections to this review workflow as configuration changes
and the only exception to the no-edit rule. Before finishing, update the
smallest owning rule in `AGENTS.md` or this prompt. Replace stale guidance and
do not preserve one-off task details.
