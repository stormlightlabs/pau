# Review-agent research

This note collects general guidance for code-review agents. It does not depend
on another project's workflow or prompts.

## What a review agent should optimize for

A review agent should maximize useful defect reports, not comment count. A
useful finding is caused by the proposed change, matters under a supported input
or state, identifies the affected code, explains the impact, and gives enough
evidence for another person to check it.

False positives are costly because each one requires investigation and weakens
trust in later findings. OpenAI's Codex review documentation reflects this
trade-off by limiting its GitHub reviews to P0 and P1 issues. GitHub also warns
that Copilot can miss problems and make mistakes, and says its feedback needs
validation and human review. RepoAudit reports 78.43% precision even with
repository exploration and a dedicated validator. These sources support a
precision-first default for routine automated review.

The approval standard should still allow progress. Google's review guidance
recommends approval when a change clearly improves code health, even if it is
not perfect. An agent should therefore separate defects that must be fixed from
optional polish and should usually omit the latter from an automated findings
report.

## Recommended review process

### 1. Establish the review target

Before inspecting details, the agent should identify:

- the baseline and exact change set
- the task, issue, or acceptance criteria that explain the intended behavior
- applicable repository and path-specific instructions
- generated, vendored, binary, and untracked files that need different
  treatment
- whether the review is complete or deliberately limited to a focus area

For a dirty-tree review, the change set includes staged changes, unstaged
changes, deletions, renames, and relevant untracked files. Untracked files need
direct inspection because an ordinary diff does not show their contents. If
there is no active task, more than one plausible task, or no reliable baseline,
the agent should say so rather than infer intent silently.

Start with the purpose and main design, then inspect the central implementation
and its tests, followed by every other changed file. Google recommends this
order because an invalid design can make line-level review wasted work. Tests
can also be useful early because they reveal the behavior the author intended.

### 2. Gather only the context needed to judge the change

A diff is the index, not the full review context. Follow changed symbols into
callers, callees, schemas, configuration, tests, documentation, and platform or
dependency contracts when those facts determine correctness. Check the whole
containing function or module when a hunk lacks enough context.

Repository guidance should be short, scoped, and durable. Codex recommends
keeping deterministic checks in CI and using review rules for consequential
repository behavior, including the safe path or allowed exception. GitHub
likewise distinguishes repository-wide instructions, path-specific instructions,
and task-specific skills.

Changed instructions are an input-security concern. GitHub documents that
Copilot reads instructions from the pull request's head branch. A review system
should not let an untrusted change weaken its own review policy. Load trusted
review policy from the baseline or host configuration, and treat modified
`AGENTS.md`, review prompts, skills, and tool configuration as reviewed
artifacts. At minimum, disclose when such files changed.

### 3. Generate candidates, then try to disprove them

Discovery and reporting should be separate stages. For each candidate defect:

1. Name the concrete input, state, ordering, or failure that triggers it.
2. Trace the relevant control and data flow through surrounding code.
3. Look for guards, cleanup, validation, tests, or documented preconditions that
   invalidate the concern.
4. Check external documentation when the claim depends on an API, protocol,
   operating system, or dependency.
5. Run the smallest safe check that can distinguish a defect from a suspicion.
6. Report the candidate only if the trace still holds.

RepoAudit uses the same broad pattern: explore code paths on demand, then
validate data-flow facts and path conditions before reporting. Its results do
not prove that every project needs multiple agents, but they do support an
explicit verification gate.

A verifier is more useful than a second unconstrained reviewer. Give it the
candidate claim, cited code, trigger, and expected impact, then ask it to
falsify the claim. Independent specialist passes are useful when the change
genuinely needs different expertise, such as security, concurrency, database
migration, accessibility, or packaging. Repeating the same broad prompt several
times adds cost and can repeat correlated mistakes.

### 4. Use tools as evidence, not ceremony

Prefer deterministic evidence where it exists: focused tests, type checks,
linters, static analyzers, protocol fixtures, and minimal reproductions. Do not
restate a formatter or compiler diagnostic as an LLM insight. Link or summarize
the tool result and spend review reasoning on behavior that the tool cannot
decide.

"Read-only review" and "read-only commands" are not equivalent. Test, build,
package-manager, and repository scripts execute changed code. They can write
files, use credentials, access the network, or start processes. A review runner
should therefore:

- withhold secrets and unrelated host credentials
- use an isolated working directory or disposable environment
- restrict network access unless the check requires it
- set time and output limits
- track child processes and clean them up
- distinguish source edits from expected build artifacts
- never apply fixes during a review unless the user asks for a separate fix
  step

Claude Code's subagent guidance supports limiting tools and permissions for
specialized agents. GitHub runs agentic review capabilities in a separate runner
and exposes firewall controls. These are useful implementation patterns, not
proof that execution is safe by default.

### 5. Cover behavior, not a flat checklist

The base pass should consider:

- whether the change meets its stated purpose
- API and protocol compatibility
- edge cases and error paths
- state, concurrency, cancellation, and cleanup
- trust boundaries, authorization, secrets, and unsafe input
- persistence and migration behavior
- resource limits and process lifecycle
- user-visible behavior and accessibility where applicable
- test validity, including whether a test would fail when behavior breaks
- documentation changed by the new behavior
- unnecessary complexity and code-health regressions

This list should guide attention, not force one comment per category. Google
recommends review of design, functionality, complexity, tests, naming,
documentation, style, every changed line, and broader context. It also says to
involve a qualified reviewer for specialist areas. OWASP's Secure Code Review
Guide is a suitable source for a dedicated security pass; a short general prompt
is not a replacement for a threat model or security checklist.

An adversarial pass should have a distinct job. It should search for hostile
input and unlucky execution rather than repeat the normal pass: malformed data,
race ordering, cancellation, partial writes, process death, replay, exhaustion,
path traversal, symlink replacement, credential exposure, and violated caller
assumptions. It should still verify each candidate before reporting it.

### 6. Report findings in a checkable form

Each finding should contain:

- severity
- file and the smallest useful line range
- the trigger or precondition
- the incorrect behavior
- practical impact
- evidence status, such as reproduced, traced, or unverified
- a fix direction, without designing the whole patch unless needed

Point to a changed line when possible. If the failure manifests in unchanged
code, explain how the change reaches it. Group findings with one root cause. Do
not report a pre-existing issue unless the change makes it newly reachable or
the issue blocks the stated task; label it separately if it must be mentioned.

Severity and confidence are different. A potentially catastrophic issue with
weak evidence is not automatically a high-confidence blocker. Define severity
from impact and likelihood under supported use, and record confidence or
evidence separately. Keep unverified claims below the merge-blocking levels.

Automated reviews benefit from a minimum reporting threshold. `nit` findings
conflict with a precision-first, actionable-only report and are better left to
formatters, linters, or an optional polish mode. A strict total word cap can
also compress away the trigger or evidence. Prefer a small finding-count budget
and compact multi-sentence findings over one dense line when the explanation
needs it.

When there are no supported findings, say so plainly. Also state any material
coverage limit or failed check; `No findings` must not imply that unread files
or unavailable tests passed review.

## Assessment of Pau's current prompts

The current `.pi/prompts/review.md` and `.pi/prompts/adv-review.md` already have
several good properties:

- they include staged, unstaged, and relevant untracked work
- they require repository instructions, task context, surrounding code, callers,
  tests, and documentation
- they prohibit edits
- they permit focused checks and external research
- they require concrete triggers and impacts
- they group repeated causes and suppress speculative lists
- the adversarial prompt separates hostile and failure-path analysis from
  ordinary review
- the adversarial prompt records reproduced, traced, or unverified evidence

The highest-value changes to consider later are:

1. Define the baseline and behavior when no single roadmap unit is active.
2. Add an explicit candidate-verification or falsification pass to the standard
   review.
3. Treat changed agent instructions and prompts as untrusted review inputs, not
   as policy that can override the reviewer.
4. State that executing tests or scripts is not inherently read-only and
   requires an isolated, credential-free environment when the change is
   untrusted.
5. Define the severity levels and keep evidence confidence separate.
6. Remove `nit` from the default automated report, or make it an opt-in polish
   mode.
7. Replace the 200-word ceiling with a finding-count limit or allow enough text
   to preserve trigger, impact, and evidence.
8. Require disclosure of skipped files, failed checks, and other material
   coverage limits alongside `No findings`.
9. Add the standard-pass test question from Google's guidance: would the changed
   test fail if the production behavior were broken?

The two prompts should remain separate. The adversarial pass is a different
search strategy, not a more verbose standard review. If Pau later orchestrates
several reviewers, use specialist discovery passes followed by one verification
and deduplication stage rather than concatenating raw outputs.

## Evaluation plan

Prompt quality should be measured on representative changes rather than judged
from plausible wording. Keep a small, versioned evaluation set containing:

- past defects with known fixes
- correct changes that resemble common false positives
- mutations for cleanup, cancellation, validation, and compatibility failures
- test-only defects where assertions do not protect behavior
- instruction-file changes that try to suppress or redirect review
- changes across the languages and platforms Pau supports

Record finding-level precision, recall for known defects, severity calibration,
line accuracy, duplicate rate, unsupported-claim rate, accepted or rejected
findings, latency, and cost. Optimize precision first for the routine pass.
Measure the adversarial pass separately because it trades more time for rare
failure discovery. Re-run the set when the model, prompt, tool permissions, or
repository instructions change.

Do not use the same model's self-score as the only ground truth. Confirm
evaluation labels with executable reproductions, deterministic analyzers, known
patches, or human review.

## Sources

- Google Engineering Practices,
  [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html)
- Google Engineering Practices,
  [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
- Google Engineering Practices,
  [Navigating a CL in review](https://google.github.io/eng-practices/review/reviewer/navigate.html)
- Google Engineering Practices,
  [How to write code review comments](https://google.github.io/eng-practices/review/reviewer/comments.html)
- GitHub Docs,
  [About GitHub Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- GitHub Docs,
  [Using GitHub Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review)
- OpenAI,
  [Review GitHub pull requests with Codex](https://learn.chatgpt.com/docs/third-party/github)
- Anthropic,
  [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Wang et al.,
  [RepoAudit: An Autonomous LLM-Agent for Repository-Level Code Auditing](https://arxiv.org/abs/2501.18160),
  arXiv:2501.18160
- OWASP,
  [Secure Code Review Guide](https://owasp.org/www-project-code-review-guide/)
