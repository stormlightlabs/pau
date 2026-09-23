# Pau agent guide

Read these files before changing the project:

- [SPEC.md](dev/SPEC.md) defines product behavior and scope.
- [PLAN.md](dev/PLAN.md) defines architecture, package ownership, design, documentation, and testing policy.
- [ROADMAP.md](dev/ROADMAP.md) defines deliverables, work units, blockers, and verification.

Do not repeat their content here. Update the owning document when a product or architecture decision changes.

## Commands

Project prompts live in `.pi/prompts/`: `/implement <unit-id>`, `/review [focus]`, and `/adv-review [focus]`.

## Work units

- Work on one ready roadmap unit at a time unless the user explicitly combines units.
- Trust roadmap statuses instead of re-auditing implementation to infer whether a blocker is done.
- Before implementation, confirm each blocker is `complete` and set the unit to `in progress`. Set it to `complete` only after its verification passes. Use `blocked` with a short status note when work cannot continue.
- Keep implementation, tests, Storybook stories, and user documentation required by that unit in the same change.
- Run the unit's verification, starting with the narrowest relevant checks. Do not invoke paid agents or remote services from default tests.
- Stop when the unit is complete. Record unrelated defects separately unless they block its verification.

## Dogfood Pau

Follow the dogfooding policy in [PLAN.md](dev/PLAN.md). After roadmap unit 1.8 is complete, use the Claude bridge for suitable Pau work. Use each later Pau surface once it is usable, and include the self-hosted smoke run required by [ROADMAP.md](dev/ROADMAP.md).

## Keep this file current

Treat this file as local project configuration. When implementation or user feedback reveals a reusable instruction that is not already in the linked documents or enforced by tooling, update this file in the same change. Keep rules short and concrete. Remove or revise stale rules, and do not store one-off task notes, secrets, machine paths, or duplicated architecture here.
