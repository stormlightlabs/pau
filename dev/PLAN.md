# Technical plan

This index is the entry point for Pau's architecture and implementation policy.
Read all linked documents before changing architecture, package ownership,
design, documentation, or testing policy.

- [Architecture and conventions](plan/architecture.md): system shape,
  repository ownership, project conventions, and persistence choices.
- [Dependency policy](plan/dependencies.md): selection rules and terminal and
  editor dependency decisions.
- [Backend contracts](plan/backend.md): commands, events, process ownership,
  monitoring, diagnostics, sandboxing, credential brokerage, and permissions.
- [Agent integrations](plan/agents.md): Pi, Claude, other adapters, and MCP.
- [Terminal and editors](plan/developer-tools.md): PTY, CodeMirror, terminal
  editors, and external editor behavior.
- [Frontend and design](plan/frontend.md): application composition, routes,
  visual system, themes, fonts, icons, and responsive behavior.
- [Website and deployment security](plan/website-and-security.md): public
  documentation, desktop authentication, and server exposure.
- [Testing](plan/testing.md): Rust, component, Storybook, browser, integration,
  and release checks.
- [Dogfooding](plan/dogfooding.md): adoption order and self-hosting policy.
