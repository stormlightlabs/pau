# Pau agent guide

Read these files before changing the project:

- [SPEC.md](dev/SPEC.md) defines product behavior and scope.
- [PLAN.md](dev/PLAN.md) defines architecture, package ownership, design,
  documentation, and testing policy.
- [ROADMAP.md](dev/ROADMAP.md) defines deliverables, work units, blockers, and
  verification.

Do not repeat their content here. Update the owning document when a product or
architecture decision changes.

## Commands

Project prompts live in `.pi/prompts/`: `/implement <unit-id>`,
`/review [focus]`, and `/adv-review [focus]`.

## Work units

- Work on one ready roadmap unit at a time unless the user explicitly combines
  units.
- Trust roadmap statuses instead of re-auditing implementation to infer whether
  a blocker is done.
- Before implementation, confirm each blocker is `complete` and set the unit to
  `in progress`. Set it to `complete` only after its verification passes. Use
  `blocked` with a short status note when work cannot continue.
- Keep implementation, tests, Storybook stories, and user documentation required
  by that unit in the same change.
- Run the unit's verification, starting with the narrowest relevant checks. Do
  not invoke paid agents or remote services from default tests.
- Stop when the unit is complete. Record unrelated defects separately unless
  they block its verification.

## Dogfood Pau

Follow the dogfooding policy in [PLAN.md](dev/PLAN.md). After roadmap unit 1.8
is complete, keep the local Claude bridge installed for personal Pi use and in
this project's Pi settings, then use it for suitable Pau work. Use each later
Pau surface once it is usable, and include the self-hosted smoke run required by
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
phases out of user-facing or published documentation.

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
