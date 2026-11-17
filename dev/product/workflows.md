# Required workflows

## Workspaces and sessions

- Open a directory and remember it.
- Create or attach a Git worktree.
- Start several sessions in one or more workspaces.
- Switch views without stopping background work.
- Resume native sessions discovered on disk.
- Send a prompt, queue a follow-up, steer a running Pi session, interrupt it
  and inspect failures.
- Show activity and attention-required states without keeping the session view
  open.
- Reconnect the UI after a desktop reload or a browser disconnect.

## Agent support

- Pi runs in structured RPC mode and keeps Pi's session, branching,
  compaction, tool and extension behavior.
- Reproduce vanilla Pi's interactive workflows with desktop controls for input,
  queues, interruption, models, thinking levels, context use, compaction,
  retries, session navigation, commands, transcript search and export.
- Load the operator's normal Pi resources and extensions. Load a Pau helper
  extension only in sessions that use a confirming permission profile.
- Support the extension dialogs, notifications, status text and string widgets
  that Pi RPC exposes. When an arbitrary terminal-only extension component
  needs vanilla Pi in a terminal, say so.
- Claude Code, Codex and Antigravity run through separate adapters. Each
  adapter prefers a documented structured protocol and falls back to a PTY only
  for terminal interaction.
- Raw PTY sessions stay available as an escape hatch, but Pau never presents
  scraped terminal output as structured tool state.

## Editor and terminal

- Browse workspace files, handling ignored and hidden files predictably.
- Use CodeMirror as Pau's built-in editor for reading, quick edits, saving,
  agent-change review, diffs, diagnostics and external-change handling. Do not
  grow it into a replacement for a full development environment.
- Show Git diffs and changed-file state.
- Open a workspace, a file, a line and column, or a diff in the operator's
  preferred external editor when that editor supports the operation. Provide
  launch adapters for Neovim, Vim, Helix, Visual Studio Code and Zed, plus a
  configurable command template.
- Keep workspace files as the source of truth. Detect changes an external
  editor makes instead of synchronizing private editor state.
- Run several persistent PTY terminals with tabs, resize, bounded scrollback,
  reconnect, search, copy and paste, activity state and exit reporting.
- Start terminals in the workspace with the user's shell, and support
  explicitly trusted direnv environments. Vim, Neovim, Helix and other terminal
  editors run in the same persistent PTY surface.
- Add optional LSP-backed CodeMirror features later, through a backend
  language-server supervisor. Deep browser embedding of a specific editor is
  outside the first release.

## Resources

- Discover Pi skills, extensions, prompts, themes and packages in their normal
  user and project locations.
- Validate skill metadata and show Pi discovery warnings.
- Install, remove, enable, disable and update Pi packages through Pi's own
  package commands or supported APIs.
- Edit resource files without silently rewriting unrelated settings.
- Keep Pau-managed MCP off by default. Until the operator turns MCP on, do not
  install packages, import configuration, connect servers or expose MCP tools.
  Keep MCP that the operator already configured natively.
- Store a workspace MCP default with a per-session override. Turn servers on
  one at a time and connect them lazily.
- Manage MCP configuration per agent, because configuration, lifecycle and
  capabilities differ between agents. Use an agent's native MCP client when it
  has one. Pi MCP support needs a Pi package the operator installs and trusts
  explicitly. Pau must not inject it into an ordinary session.
- Keep MCP OAuth credentials in the native client or the adapter's credential
  store. Apply the active agent permission policy to MCP tools. Never reuse
  model or MCP credentials as credentials for sandboxed commands.
- Treat extensions, packages, skills with scripts and MCP servers as code that
  runs or carries instructions. Show their source and scope before the operator
  grants trust.

## Resource use

- Show current and peak resource use for Pau and each managed process tree,
  including Pi, Claude, terminals, external editors Pau launched and stdio MCP
  servers.
- Report CPU, resident memory, process count, elapsed time and disk I/O where
  the operating system exposes them reliably.
- Keep a short local history and a final summary per session. Do not keep raw
  samples indefinitely or send telemetry to a remote service.
- Warn about sustained resource pressure and offer interrupt and stop
  controls. Do not throttle or end work automatically by default.
- Keep model context, token and cost usage separate from machine resource use.

## Diagnostics

- Ship diagnostics in release builds behind an explicit setting and a CLI
  flag. Keep fault injection and other behavior-changing controls in
  development builds.
- Show frontend, backend, adapter and relevant dependency versions, with
  adapter capabilities and handshake results.
- Report transport state, reconnect attempts, event sequence and replay gaps,
  managed process identity and exit history, queue pressure, slow consumers and
  dropped updates.
- Keep bounded backend and adapter logs and a small redacted metadata trace.
  Capture protocol payloads only after temporary explicit enablement.
- Let the operator export a diagnostic bundle with versions, capabilities,
  process summaries, transport state, configuration shape and recent redacted
  logs.
- Keep credentials, environment values, prompts, file contents, tool
  arguments, transcript content, paths outside the workspace and other
  sensitive values out of routine diagnostics and exported bundles.
- Diagnostics must not change process supervision, permissions, sandboxing,
  retry policy or timeouts.

## Permission controls

- Keep permission prompting off by default. Offer profiles for no prompts, for
  confirming writes and commands, and for confirming mutating or open-network
  operations. A session without a confirming profile behaves like vanilla Pi
  and loads no permission extension.
- Show permission controls only when the adapter can allow or deny an
  operation before it runs. Never present observation after the fact as
  approval.
- Under a confirming profile, allow workspace reads except protected sensitive
  paths, ask before reads outside the workspace, and deny high-confidence
  credential and authentication paths by default. Without a confirming profile,
  only a selected sandbox restricts reads. Only a user-scoped rule may relax a
  default sensitive-path restriction. Project configuration may only narrow
  access.
- Offer deny, allow once and allow for this session. The first release does
  not keep an approval across sessions.
- Keep permission policy separate from sandbox policy. An approval permits an
  attempt but never widens the filesystem, network, environment, credential or
  process access the sandbox grants.
- Queue concurrent requests per session while other sessions stay usable.
  Match each decision to its request and session, reject stale responses,
  cancel a request with its operation, and fail closed on timeout or
  disconnect.
- Name the requesting session, the tool, the command or affected paths, and
  the requested access.
- Treat direct terminal input as an operator action, not an agent tool
  request. It does not trigger an agent permission prompt.
- Record redacted permission decisions without storing credentials or
  sensitive arguments.

## Desktop and web

- The Tauri app owns the local desktop product, starts its Axum backend and
  exposes native capabilities through explicit desktop interfaces.
- The desktop frontend can run in a normal browser during development without
  becoming the remote web product.
- The later web app connects to a standalone Pau server. It has its own
  routes, remote authentication, connection states and capability gating.
- Where their backend capabilities overlap, both apps use HTTP for
  request and response operations and a WebSocket for live events.
- A reconnecting client receives a snapshot, then the events newer than a
  sequence number it supplies.
- Server mode binds to loopback by default and supports access through a
  private tunnel or tailnet without turning off authentication.
- Binding directly to a non-loopback address needs explicit authentication
  configuration and shows a warning.
- The web app names the host that owns the workspace and processes. It does
  not present desktop-only dialogs, windows, updates or local editor
  integration as remote capabilities.
