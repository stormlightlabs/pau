# Required workflows

## Workspaces and sessions

- Open a directory and remember it.
- Create or attach a Git worktree.
- Start multiple sessions in one or more workspaces.
- Switch views without stopping background work.
- Resume native sessions discovered on disk.
- Send a prompt, queue a follow-up, steer a running Pi session, interrupt it,
  and inspect failures.
- Show activity and attention-required states without requiring the session view
  to stay open.
- Reconnect the UI after a desktop reload or browser disconnect.

## Agent support

- Pi uses structured RPC mode and retains Pi's session, branching, compaction,
  tools, and extension behavior.
- Reproduce vanilla Pi's interactive workflows with desktop controls for input,
  queues, interruption, models, thinking levels, context use, compaction,
  retries, session navigation, commands, transcript search, and export.
- Load the operator's normal Pi resources and extensions. Do not inject a Pau
  helper extension into ordinary sessions.
- Support extension dialogs, notifications, status text, and string widgets
  exposed through Pi RPC. Explain when an arbitrary terminal-only extension
  component requires vanilla Pi in a terminal.
- Claude Code, Codex, and Antigravity run through separate adapters. Each
  adapter prefers a documented structured protocol and falls back to a PTY only
  for terminal interaction.
- Raw PTY sessions remain available as an escape hatch, but terminal scraping is
  not presented as structured tool state.

## Editor and terminal

- Browse workspace files with ignored and hidden files handled predictably.
- Use CodeMirror as Pau's primary built-in editor for reading, quick edits,
  saving, agent-change review, diffs, diagnostics, and external-change handling.
  Do not expand it into a replacement for a full development environment.
- Show Git diffs and changed-file state.
- Open a workspace, file, line and column, or diff in the operator's preferred
  external editor when that editor supports the operation. Provide known launch
  adapters for Neovim, Vim, Helix, Visual
  Studio Code, and Zed, plus a configurable command template.
- Keep workspace files as the source of truth and detect changes made by an
  external editor instead of synchronizing private editor state.
- Run multiple persistent PTY terminals with tabs, resize, bounded scrollback,
  reconnect, search, copy and paste, activity state, and exit reporting.
- Start terminals in the workspace with the user's shell and support explicitly
  trusted direnv environments. Vim, Neovim, Helix, and other terminal editors
  run through the same persistent PTY surface.
- Add optional LSP-backed CodeMirror features later through a backend
  language-server supervisor. Deep browser embedding for a specific editor is
  outside
  the first release.

## Resources

- Discover Pi skills, extensions, prompts, themes, and packages from their
  normal user and project locations.
- Validate skill metadata and show Pi discovery warnings.
- Install, remove, enable, disable, and update Pi packages through Pi's own
  package commands or supported APIs.
- Edit resource files without silently rewriting unrelated settings.
- Keep Pau-managed MCP off by default. Do not install packages, import
  configuration, connect servers, or expose MCP tools until the operator enables
  MCP. Preserve MCP that the operator already configured natively.
- Store a workspace MCP default with a per-session override. Enable servers
  individually and connect them lazily.
- Manage enabled MCP configuration per agent because configuration, lifecycle,
  and capabilities differ by agent. Use each agent's native MCP client when it
  has one. Pi MCP support requires an explicitly installed and trusted Pi
  package; Pau must not inject it into an ordinary session.
- Keep MCP OAuth credentials in the native client or adapter credential store.
  Apply the active agent permission policy to MCP tools. Never reuse model or MCP
  credentials as sandboxed command credentials.
- Treat extensions, packages, skills with scripts, and MCP servers as executable
  or instruction-bearing code. Show source and scope before trust is granted.

## Resource use

- Show current and peak resource use for Pau and each managed process tree,
  including Pi, Claude, terminals, external editors launched by Pau, and stdio
  MCP servers.
- Report CPU, resident memory, process count, elapsed time, and disk I/O where
  the operating system exposes it reliably.
- Keep a short local history and a final session summary. Do not retain raw
  samples indefinitely or send telemetry to a remote service.
- Warn about sustained resource pressure and offer interrupt or stop controls.
  Do not throttle or terminate work automatically by default.
- Keep model context, token, and cost usage separate from machine resource use.

## Diagnostics

- Ship diagnostics in release builds behind an explicit settings control and CLI
  flag. Keep fault injection and other behavior-changing controls in development
  builds.
- Show frontend, backend, adapter, and relevant dependency versions together
  with adapter capabilities and handshake results.
- Report transport state, reconnect attempts, event sequence and replay gaps,
  managed process identity and exit history, queue pressure, slow consumers, and
  dropped updates.
- Keep bounded backend and adapter logs and a small redacted metadata trace.
  Require temporary explicit enablement before capturing protocol payloads.
- Let the operator export a diagnostic bundle with versions, capabilities,
  process summaries, transport state, configuration shape, and recent redacted
  logs.
- Exclude credentials, environment values, prompts, file contents, tool
  arguments, transcript content, paths outside the workspace, and other
  sensitive values from routine diagnostics and exported bundles.
- Diagnostics must not change process supervision, permissions, sandboxing,
  retry policy, or timeouts.

## Permission controls

- Keep permission prompting off by default. Offer profiles for no prompts,
  confirming writes and commands, and confirming mutating or open-network
  operations. A session without a confirming profile behaves like vanilla Pi
  and loads no permission extension.
- Show permission controls only when the adapter can allow or deny an operation
  before it executes. Never present observation after execution as approval.
- Under a confirming profile, allow workspace reads except for protected
  sensitive paths, ask before reads outside the workspace, and deny
  high-confidence credential and authentication paths by default. Without one,
  only a selected sandbox restricts reads. Only a user-scoped rule may relax a
  default sensitive-path restriction. Project configuration may only narrow
  access.
- Offer deny, allow once, and allow for this session. Do not persist an approval
  across sessions in the first release.
- Keep permission policy separate from sandbox policy. Approval permits an
  attempt but never expands filesystem, network, environment, credential, or
  process access granted by the sandbox.
- Queue concurrent requests per session while keeping other sessions usable.
  Correlate decisions by request and session, reject stale responses, cancel
  requests with their operation, and fail closed on timeout or disconnect.
- Identify the requesting session, tool, command or affected paths, and requested
  access.
- Treat direct terminal input as an operator action rather than an agent tool
  request. It does not trigger an agent permission prompt.
- Record redacted permission decisions without storing credentials or sensitive
  arguments.

## Desktop and web

- The Tauri app owns the local desktop product, starts its Axum backend, and
  exposes native capabilities through explicit desktop interfaces.
- The desktop frontend can run in a normal browser during development without
  becoming the remote web product.
- The later web app connects to a standalone Pau server. It has its own routes,
  remote authentication, connection states, and capability gating.
- Both applications use HTTP for request/response operations and a WebSocket for
  live events where their backend capabilities overlap.
- Reconnecting clients receive a snapshot followed by events newer than a
  supplied sequence number.
- Server mode binds to loopback by default and supports access through a private
  tunnel or tailnet without disabling authentication.
- Direct non-loopback binding requires explicit authentication configuration and
  a warning.
- The web app names the host that owns the workspace and processes. It does not
  present desktop-only dialogs, windows, updates, or local editor integration as
  remote capabilities.
