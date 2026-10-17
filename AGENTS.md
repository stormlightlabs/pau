# Pau agent guide

Read these indexes and every document they link before changing the project:

- [SPEC.md](dev/SPEC.md) indexes product behavior and scope.
- [PLAN.md](dev/PLAN.md) indexes architecture, package ownership, design,
  documentation, and testing policy.
- [ROADMAP.md](dev/ROADMAP.md) indexes the deliverable files in `dev/tasks/`,
  which define each work unit's status, blockers, scope, and verification.

Do not repeat their content here. Update the owning document when a product or
architecture decision changes.

## Commands

Project prompts live in `.pi/prompts/`, with Claude Code equivalents in
`.claude/commands/`: `/implement <unit-id>`, `/review [focus]`, and
`/adv-review [focus]`. Keep equivalent commands synchronized when their workflow
changes.

`cargo clean` regularly to keep the disk clean.

On macOS, do not enter the Nix shell or use direnv. Use the Homebrew and rustup
toolchain described in `README.md`, and keep local settings in `.env`. The flake
and `.envrc` serve NixOS only.

Run JavaScript tools through pnpm with `pnpm exec`, `pnpm --filter`, or a
package script. Do not use `npx`.

Do not start Docker Desktop or another container or virtual-machine runtime
without explicit user approval. Use an already-running runtime only when the
active unit requires it.

Run heavyweight verification serially. Do not run `pnpm check`, browser tests,
Storybook or website builds, and Cargo builds at the same time. Resource
contention can cause false timeouts in process and interaction tests. Run a full
application or repository build only when the active unit requires it or the
change affects that build boundary. After a follow-up edit, rerun the narrowest
check that covers the changed code; rebuild only when the edit can affect the
built artifact.

## Work units

- Work on one ready roadmap unit at a time unless the user explicitly combines
  units.
- Trust roadmap statuses instead of re-auditing implementation to infer whether
  a blocker is done.
- Before implementation, confirm each blocker is `complete` and set the unit to
  `in progress`. Set it to `complete` after available verification passes. An
  unavailable platform check may move to the backlog when portable coverage
  passes and it is not an explicit release gate. Use `blocked` with a short
  status note when implementation cannot continue.
- Keep implementation, tests, Storybook stories, and user documentation required
  by that unit in the same change.
- In `packages/ui`, keep stories under `src/stories` and tests under
  `src/tests`.
- Run the unit's verification, starting with the narrowest relevant checks. Do
  not invoke paid agents or remote services from default tests.
- Fix every finding from the unit's required verification, including unrelated
  pre-existing findings. Do not defer or report those findings as separate
  follow-up work. Keep defects found outside required checks separate unless
  they block verification.
- When a unit is complete, add a concise user-facing changelog entry when it
  changes user-facing behavior, remove it from every blocker list, and delete
  the unit from its deliverable file. Delete a subsection or deliverable when
  it has no units left.
- Write commit messages and pull request descriptions without agent
  attribution. Omit `Co-Authored-By` trailers and generated-by lines.

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
prompts, UI copy, error messages, comments, and release text. Load the skill
before drafting, not only when polishing the result.

Always audit changed prose against that skill before finishing. Remove AI
writing tropes, stock transitions, repetition, inflated claims, and other
formulaic language. Keep roadmap terms, unit boundaries, and implementation
phases out of user-facing or published documentation. Name packages, scripts,
and files for what they do, not for the unit phase that created them, such as
a spike.

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

Keep `dev/design`, the `pau.fig` design file, and its PNG exports in
`dev/prototype` synchronized. When a durable visual, interaction, or responsive
decision changes, update the owning design document, the affected frames, and
their exported PNGs together. Visual-only polish needs a document change only
when it changes the recorded system or surface contract.

In `pau.fig`, build screens from the shared components and bind colors, type
sizes, spacing, and radii to the token variables instead of raw values.

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

## Keep agent configuration current

Treat direct user corrections to project workflows as configuration changes.
Update the smallest owning rule in `AGENTS.md` or `.pi/prompts/` in the same
change, even when the active prompt otherwise prohibits edits. This exception
applies only to workflow configuration. Replace stale guidance instead of
adding a contradictory exception. Do not store one-off task notes, secrets,
machine paths, or duplicated product and architecture decisions here.
