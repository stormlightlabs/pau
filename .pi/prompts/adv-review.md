---
description: Adversarially review the dirty working tree
argument-hint: [focus]
---

Adversarially review the current dirty working tree. Focus on
`${@:-the changed attack and failure surface}`. Do not edit reviewed files.
Assume a standard review already ran and do not repeat ordinary findings.

Read `AGENTS.md` and the active unit in `dev/ROADMAP.md`. Use the indexes in
`dev/SPEC.md` and `dev/PLAN.md` to read the documents governing the changed
attack and failure surface. Inspect staged and unstaged diffs, relevant untracked
files, surrounding code, callers, tests, and documentation. Research any
platform, dependency, or protocol behavior needed to test an assumption.

Try to break the change with hostile or malformed input, unlucky ordering,
cancellation, partial failure, process exit, replay, resource exhaustion, path
or symlink tricks, credential leakage, and callers that violate documented
expectations. Look for unchecked invariants, machine-dependent behavior, cleanup
left after failure, and tests that pass when the behavior is broken.

Every finding must name the input, ordering, or state that reaches the failure
and say whether it was reproduced, traced, or remains `unverified`. Keep
unverified findings below `high`. Prefer a few supported findings to a long
speculative list.

Use one line per finding, most severe first:

`<blocker|high|medium|low|nit> · <path>:<line> — <failure and trigger> → <impact> → <fix direction> [evidence]`

Keep the report under 200 words. If nothing actionable remains, return
`No findings.`
