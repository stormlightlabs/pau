# Roadmap

This index is the entry point for Pau's deliverables and work units. Each
deliverable has its own file in `tasks/`, named with its zero-padded number.

Work is organized into ordered deliverables. Each numbered unit should fit in
one issue and one pull request. Its verification belongs in the same pull
request. Units are ordered unless a dependency is stated explicitly.

Documentation is part of the unit that introduces or changes user-facing
behavior. Before `apps/website` exists, keep the relevant package README
accurate. After it exists, update the corresponding website page in the same
pull request. Documentation verification includes the website build,
internal-link checks, and any copyable command checks that apply to the unit.

A unit that adds or materially changes UI also adds or updates its Storybook
stories in the same pull request. Stories expose representative states without
requiring a live agent. Verification runs relevant Vitest unit and browser
component tests, Storybook interaction and accessibility tests, and Playwright
integration tests only when the behavior crosses an application boundary.

When a unit first makes a Pau surface usable, its verification includes a
self-hosted smoke run when practical. The Claude bridge is the first dogfood
surface: after its live smoke test passes, use it for suitable Pau work. Later
units use working Pau surfaces during normal development without replacing
deterministic tests or widening the active unit.

## Unit metadata

Each unit has an explicit status:

- `planned`: Work has not started.
- `in progress`: Implementation is active.
- `blocked`: Work started but cannot continue. Add a short `Status note` below
  the status.
- `complete`: Implementation and the unit's verification are complete.

Update the status when work starts, becomes blocked, resumes, or completes.
Treat it as the source of truth instead of inspecting the implementation to
infer completion. A deliverable is complete only when every unit in it has
status `complete`. Keep completed units in the active deliverable. When the
whole deliverable is complete, record it in `CHANGELOG.md`, remove satisfied
references to it from blocker lists, and delete its task file and its entry in
this index.

Each unit also lists its direct blockers. A whole number refers to every unit in
that deliverable; for example, `Blocked by: 2` means every unit in deliverable 2
must be `complete`. A dotted identifier refers to one unit.
Transitive blockers are implied and are not repeated. `Blocked by: none` means
there is no dependency. A planned unit is ready when every listed blocker has
status `complete`.

## Deliverables

- [2. Desktop app and development browser UI](tasks/002_desktop-app-and-development-browser-ui.md)
- [3. Web server](tasks/003_web-server.md)
- [Backlog](tasks/000_backlog.md)
