# Pau agent guide

Read these indexes and every document they link before changing the project:

- [SPEC.md](dev/SPEC.md) indexes product behavior and scope.
- [PLAN.md](dev/PLAN.md) indexes architecture, package ownership, design,
  documentation, and testing policy.
- [ROADMAP.md](dev/ROADMAP.md) sets the rules for splitting work into tasks.
  The tasks themselves live in Linear, as [Tasks](#tasks) describes.

Do not repeat their content here. Update the owning document when a product or
architecture decision changes.

## Commands

The `fab-implement`, `fab-review`, `fab-adv-rev` and `fab-storm` skills run
the agent workflow. `fab-implement` works one task on its own branch,
`fab-review` and `fab-adv-rev` review a pull request or branch, and
`fab-storm` takes a task through implementation and review. Claude Code runs
them as `/fab-implement`, and Pi as `/skill:fab-implement`.

An adversarial review of Pau also tries credential and secret leakage, path and
symlink tricks, process exit and orphaned children, and resource exhaustion,
most of all around the sandbox and agent processes.

Each worktree builds its own `target/` of several gigabytes. Run `cargo clean`
in a worktree once its task's Cargo checks pass, before handing it off or
removing it, and in the main checkout after pulling a merge.

On macOS, do not enter the Nix shell or use direnv. Use the Homebrew and rustup
toolchain described in `README.md`, and keep local settings in `.env`. The flake
and `.envrc` serve NixOS only. Install standalone CLIs from Homebrew or the
vendor's release, not from nixpkgs.

Run JavaScript tools through pnpm with `pnpm exec`, `pnpm --filter`, or a
package script. Do not use `npx`.

Do not start Docker Desktop or another container or virtual-machine runtime
without explicit user approval. Use an already-running runtime only when the
active task requires it.

Run heavyweight verification serially. Do not run `pnpm check`, browser tests,
Storybook or website builds, and Cargo builds at the same time. Resource
contention can cause false timeouts in process and interaction tests. Run a full
application or repository build only when the active task requires it or the
change affects that build boundary. After a follow-up edit, rerun the narrowest
check that covers the changed code; rebuild only when the edit can affect the
built artifact.

## Tasks

The installed skills read this section for the tracker's steps. Linear is the
tracker for all work, and a `PAU-<n>` ID is a Linear issue. Issues live in
the Linear team PAU. Agents reach it through the session's Linear connector tools,
such as `get_issue` with relations, `save_issue`, `save_comment`, and
`save_document`. Subagents run inside that session and need no Linear access
of their own.

The unit of work in this repository is a parent issue or an issue with no
parent. A sub-issue is never dispatched on its own. A parent belongs to one
release milestone, and every sub-issue carries the same milestone. When its
sub-issues sit in different milestones, the parent and all its sub-issues move
to the earliest one.

| Step                                     | In Linear                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read a task                              | The PAU issue, its comments, its relations, its sub-issues, and its project                                                                                                                                                                                                                                                                                                                                                          |
| Check readiness                          | A parent issue or an issue with no parent, in Todo, with every issue it is blocked by Done, Canceled or Duplicate. A parent is not ready while any of its sub-issues is In Progress or In Review on another branch: stop and report. Pau checks this itself because fab-implement looks for `storm/<child>` branches and searches PR bodies for the ID, while Pau uses `claude/pau-n` branches and keeps Linear IDs out of PR bodies |
| Start                                    | Set In Progress and comment `Claimed on claude/<issue id>`, then re-read the comments. The earliest claim comment holds the claim, in place of `fab claim`; if it names another branch or run, stop and report. Work on the branch `claude/<issue id, lowercase>`, such as `claude/pau-1`, in a worktree under `../pau-worktrees/`. Linear's default `gitBranchName`, `<user>/pau-n-…`, is not used                                  |
| Open the PR                              | Link the PR on the issue and set In Review. The PR body and commits carry no Linear ID and no `Closes` line for a Linear issue, in place of fab-implement's `Closes` lines: the link on the issue ties them together, and Complete closes the issues                                                                                                                                                                                 |
| Complete                                 | After the PR merges, first move each sub-issue the PR did not do, such as an unavailable platform check, out of the parent, to Backlog or another parent. Then set each sub-issue the PR finished Done, then the issue, with the comment `Done in #<n> at <sha>: <summary>` on the issue. This replaces fab-implement's after-merge step that closes each sub-issue left open. Never close an issue without a PR                     |
| Hand off                                 | Before any push, comment the handoff note and `Released`, and set Todo. Once a PR exists, comment the handoff note and leave the issue In Review with the PR linked                                                                                                                                                                                                                                                                  |
| Pick up                                  | Read the latest handoff note. Continue the linked PR when there is one, and otherwise claim the issue as Start does                                                                                                                                                                                                                                                                                                                  |
| Record new work                          | A new PAU issue in the right project, in Todo when it is ready to work or Backlog when it is untriaged, with its blocked-by links set when it is created                                                                                                                                                                                                                                                                             |
| Record an idea or spec                   | A Linear document on the team or the project                                                                                                                                                                                                                                                                                                                                                                                         |
| Record a report, review or resource list | One Linear document on the issue, with links and screenshots, kept current. Not comments, and not one link resource per item                                                                                                                                                                                                                                                                                                         |

`fab-decompose` writes these primitives with `save_issue`:

| Primitive  | In Linear         | Written as                                                                                                                                                                                                  |
| ---------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection | A project         | `project` on each issue                                                                                                                                                                                     |
| Run unit   | A parent issue    | An issue in that project and in one release milestone                                                                                                                                                       |
| Task       | A sub-issue       | `parentId` set to the run unit, and the run unit's milestone                                                                                                                                                |
| Dependency | A blocked-by link | `blockedBy` with the blocker IDs. A dependency on another feature goes on the run units, never on their sub-issues, although fab-decompose files it on the task: readiness reads only the parent's blockers |

Blocked-by links between parents decide what can run in parallel. List the
Todo parent issues and issues with no parent, drop any that are not ready, and
give each worktree one.

Every issue follows these rules:

- Work on one unit of work per branch, session and pull request unless the
  user explicitly combines them. Parallel worktrees may each work a different
  one.
- Keep implementation, tests, Storybook stories, and user documentation required
  by the issue in the same change.
- In `packages/ui`, keep stories under `src/stories` and tests under
  `src/tests`.
- Run the issue's verification, starting with the narrowest relevant checks. Do
  not invoke paid agents or remote services from default tests.
- A release's gates are the issues in its milestone in the tracker. When a
  platform check is unavailable, the issue may close if portable coverage
  passes and the check's issue is not in that milestone. Record the unavailable
  check as a new Backlog issue.
- Fix every finding from the issue's required verification, including unrelated
  pre-existing findings. Do not defer or report those findings as separate
  follow-up work. Keep defects found outside required checks separate unless
  they block verification.
- Do not write CHANGELOG entries in an issue's pull request. Changelog updates
  are being automated from the squash commits on `main`.
- Write commit messages and pull request descriptions without agent
  attribution. Omit `Co-Authored-By` trailers and generated-by lines.
- Author commits with the owner's GitHub noreply address,
  `71664048+desertthunder@users.noreply.github.com`, and use it in any
  trailer. GitHub rejects a push whose author email is private.
- Title pull requests as Conventional Commits, such as `feat(server): …` or
  `docs: …`. The title becomes the squash commit's subject on `main`.

## Dogfood Pau

Follow the [dogfooding policy](dev/plan/dogfooding.md). Keep the released local
Claude bridge installed for personal Pi use and in this project's Pi settings,
then use it for suitable Pau work. Use each later Pau surface once it is usable,
and include the self-hosted smoke run required by
[ROADMAP.md](dev/ROADMAP.md).

When the agent already runs inside Zellij, perform Zellij verification in a new
tab of the current session. Do not create a nested Zellij session unless explicitly
asked to do so.

## Writing

Before writing or editing project prose, load and follow the `writing`,
`writing-docs`, or equivalent available skill. This includes documentation,
prompts, UI copy, error messages, comments, release text, commit messages, and
pull request descriptions. Load the skill before drafting, not only when
polishing the result. A delegated agent that writes any of these gets the same
instruction in its prompt.

Always audit changed prose against that skill before finishing. Remove AI
writing tropes, stock transitions, repetition, inflated claims, and other
formulaic language. Keep issue boundaries and implementation phases out of
user-facing or published documentation. The repository is open source, so
never put Linear issue IDs, Linear URLs or Claude Design artifact links in
prose, code, docs or commit messages. Branch names are exempt, since they
follow `claude/<issue id>`, and so is the branch that fabrial's pull request
footer prints. Naming Linear and the PAU team is fine. Name packages,
scripts, and files for what they do, not for the phase of work that created
them, such as a spike.

Write the description or prose body of each issue, document, and pull request
for the item it describes, and never carry a fixed sentence from one to the
next. A format that `AGENTS.md`, a skill, or a workflow prescribes is not
boilerplate: copy it word for word, such as `Closes #<n>` and the
`<!-- fabrial:footer` block in a pull request body. Process rules, such as how
a parent issue closes or how a claim works, belong once in the Tasks section.
When you brief another agent, say what each item must cover, not the words to
use, and pass any prescribed format word for word.

Wrap prose at about 80 columns. A few trailing characters are acceptable when a
clean break would hurt readability. Do not wrap tables, long links, indivisible
code or literals, or required one-line templates. Use this audit as a starting
point and inspect each exception:

```sh
find . -type f \( -name '*.md' -o -name '*.mdx' \) \
  -not -path './.git/*' -not -path './node_modules/*' -print0 \
  | xargs -0 awk 'length($0) > 84 { print FILENAME ":" FNR ":" length($0) }'
```

Write list items as independent items, not as one sentence split across lines.
Do not end bullets with semicolons. Use periods when every item is a complete
sentence. Leave sentence fragments unpunctuated.

Prefer TypeScript type aliases for data shapes and unions. Use interfaces only
for method-only contracts or types that classes implement.

When a durable visual, interaction, or responsive decision changes, update
the owning document in `dev/design`. Visual-only polish needs a document change
only when it changes the recorded system or surface contract.

Use kebab-case for TypeScript filenames, including `.svelte.ts` modules. Keep
Svelte component filenames in PascalCase, and preserve that component name in
associated files such as `SessionView.stories.ts` and
`SessionView.svelte.test.ts`.

Format the whole repository with `pnpm format` instead of running Prettier in
check-only mode or formatting selected files. Keep unrelated formatting changes
in the diff. Ignore generated output instead of whole packages.

Use TSDoc for exported TypeScript symbols and rustdoc for public Rust symbols.
Also document private symbols that carry important context, invariants, safety
requirements, lifecycle rules, error behavior, or non-obvious design intent.
Write comments for maintainers: explain the contract and why it exists instead
of restating the implementation.

## UI work

Before changing a visible surface, load the `ui-design` skill and follow its
bounded visual verification. For each changed surface:

- Screenshot it inside the application shell at 1440×900 and at 900px wide,
  and look at every screenshot before finishing.
- Measure rendered boxes to check alignment instead of judging it by eye.
  Controls in a row share a center line, and stacked content shares a leading
  edge.
- Check each state the surface can reach, including empty, long content,
  disabled, and error.
- Use real data volumes, such as a full model list or a large workspace, not
  two-item fixtures.
- Walk the whole path with the mouse and the keyboard. Open and dismiss each
  overlay by an outside press and Escape, and confirm where focus returns.
- Fix broken tasks and missing states before visual drift, and visual drift
  before cleanup.
- Put the screenshot paths and measurements on the task's Linear issue
  document.

`dev/design` owns design decisions. Where a visual reference disagrees with
it, `dev/design` wins.

Storybook indexes no stories from worktrees under `.claude/`, so take those
screenshots from a temporary Vitest browser test and delete it afterwards.

## Keep agent configuration current

Treat direct user corrections to project workflows as configuration changes.
Update the smallest owning rule in `AGENTS.md` in the same change, even when
the active prompt otherwise prohibits edits. This exception applies only to
workflow configuration. Replace stale guidance instead of adding a
contradictory exception. Do not store one-off task notes, secrets, machine
paths, or duplicated product and architecture decisions here.

<!-- prettier-ignore-start -->
<!-- fabrial:begin -->
## Branches and pull requests

This repository uses fabrial. `fab init` wrote this section and the files it
names, `fab update` refreshes them, and `fab check` reports where they have
drifted.

- Never commit to `main`. Push a `claude/<topic>`, `codex/<topic>` or
  `storm/<task>` branch; Branch PR open, which runs after the push's Branch
  PR run, opens the pull request as a draft from the repository's GitHub
  App, which `app` in `.github/fabrial.toml` names. Branch PR open does not
  run for the branch that adds it, since GitHub runs it only from `main`:
  push that branch first with `main`'s `branch-pr.yml`, which opens the pull
  request, then push the new `branch-pr.yml`.
- Commits on those branches may carry the agent's attribution trailers. The
  squash commit replaces them with the PR title and number, such as
  `Add Pi dispatch (#21)`, the PR body above its
  `<!-- fabrial:footer` line, `Merged from <branch>.` and the owner's
  `Co-authored-by` line from `.github/fabrial.toml`. Attribution lines and
  session links in the body are dropped, so `main` carries no AI attribution
  beyond the `Assisted-by` lines below. Editing the title or body of a
  reviewed PR posts the new squash message. Auto-merge keeps the message it
  was turned on with.
- When `.github/fabrial.toml` sets `signoff`, the squash message ends with
  the owner's `Signed-off-by` line: the owner certifies agent work at merge.
  Agents never add `Signed-off-by`, and the squash drops one written in a PR
  body.
- When `.github/fabrial.toml` sets `assisted_by = "on"`, the squash message
  names each agent model the commits' `Co-authored-by` trailers name, as
  `Assisted-by: <model>`. Agents never write `Assisted-by` in a PR body; the
  squash drops it.
- Before pushing, run `fab gates`. It runs the checks
  `.github/fabrial-gates.toml` names for the files the change touches, or the
  command `gates` names in `.github/fabrial.toml` when that file is missing.
- The owner approves the PR and merges it, with the posted squash message or
  their own edit of it. Agents never approve or merge.
- Keep the PR body to what changed and why. Put verification in a PR comment.
  Leave out attribution lines and session links.
- Agents post PR comments as the App through the Bot comment workflow
  (`.github/workflows/comment.yml`), never with their own GitHub access.
- The agent that opens a PR reviews it with the `fab-storm` skill and ends
  with a `Review finished at <sha>` comment. That turns `storm/review` green
  for that head, marks the draft ready and sets the squash message in the
  bot's status comment, which it edits rather than posting anew. The owner
  merges, by hand or with auto-merge they turn on; agents and the gate never
  turn it on.
  `/storm:ready <sha>` or `/storm:done <sha>` from a user with write access
  accepts that head as it is.

## Writing

Everything here is read by a person: docs, commit messages, PR titles and
bodies, comments, and replies. Keep it short and plain:

- Lead with the point, and say each thing once.
- Use short sentences, common words, and one term for one thing.
- Cut preambles, summaries of what was just said, and sign-offs.
- Name the property, the limit or the failure, not a judgment of it.
- Stay inside the length targets: a PR body around 150 words, a review comment
  200, any other comment 100.

`.claude/skills/fab-writing-docs/` holds the full standard, and its
`references/tells.md` lists the patterns that make text read as generated.
Check a draft against both before committing or posting.
<!-- fabrial:end -->
<!-- prettier-ignore-end -->
