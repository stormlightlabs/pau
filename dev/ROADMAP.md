# Planning work

Pau's issues, their order, and their dependencies live in the project's issue
tracker, as the Tasks section of [`AGENTS.md`](../AGENTS.md) describes. This
file sets the rules for splitting work into parent issues, each closed by one
pull request, and into the sub-issues that are the steps of that pull request.

Give each sub-issue one behavior that its title and a one-sentence description
can state. When a description lists several features, give each feature its
own parent issue.

Split sub-issues by layer. A backend step changes one service, protocol, or
adapter and proves it with fixture tests. A frontend step builds UI on backend
steps that come before it and checks that work by using it. Alternate backend
and frontend steps where dependencies allow.

Size a parent by its pull request as a whole, which carries every sub-issue
and its verification. That pull request should be small enough to review in
one sitting and to revert without removing unrelated work, usually a few
hundred lines of hand-written source. When it would be larger, split the parent
into two parents.

Documentation is part of the issue that introduces or changes user-facing
behavior. Before `apps/website` exists, keep the relevant package README
accurate. After it exists, update the corresponding website page in the same
pull request. Documentation verification includes the website build,
internal-link checks, and any copyable command checks that apply to the issue.

An issue that adds or materially changes UI also adds or updates its Storybook
stories in the same pull request. Stories expose representative states without
requiring a live agent. Verification runs relevant Vitest unit and browser
component tests, Storybook interaction and accessibility tests, and Playwright
integration tests only when the behavior crosses an application boundary.

When an issue first makes a Pau surface usable, its verification includes a
self-hosted smoke run when practical. The Claude bridge is the first dogfood
surface: after its live smoke test passes, use it for suitable Pau work. Later
issues use working Pau surfaces during normal development without replacing
deterministic tests or widening the active issue.
