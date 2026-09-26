# Product specification

## Purpose

The app gives one operator a single place to run coding agents, inspect their
work, edit files, and use a terminal. It targets developers who work across
several repositories and want concurrent agents without hiding the underlying
processes or files.

Pi is the reference implementation. Other agents are supported where their CLIs
expose enough control to provide a reliable adapter.

## Core concepts

### Workspace

A local directory or Git worktree. A workspace owns terminals, editor state, and
agent sessions. The app must not assume that one repository has only one active
workspace.

### Agent session

A long-lived process and its native persisted conversation. A session has an
adapter, workspace, status, capabilities, and ordered event stream. The agent's
own files remain the source of truth for conversation history.

Statuses are `starting`, `idle`, `running`, `waiting`, `stopping`,
`stopped`, and `failed`.

### Adapter

An implementation for one agent protocol. Every adapter reports capabilities
rather than relying on product-wide assumptions. Initial capabilities include:

- start, resume, stop, and interrupt
- prompt, steer, and follow up
- streamed text and structured tool events
- model and thinking-level selection
- session branching or forking
- permission requests
- resource discovery and reload

Unsupported controls are hidden or disabled with an explanation.

### Resource

A skill, Pi extension or package, prompt template, MCP server configuration, or
agent-specific plugin. Scope is explicit: user, workspace, or project. The app
shows the file or command it will change before applying an update.

## Required workflows

### Workspaces and sessions

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

### Agent support

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

### Editor and terminal

- Browse workspace files with ignored and hidden files handled predictably.
- Open and save text files in CodeMirror.
- Show Git diffs and changed-file state.
- Run multiple persistent PTY terminals with tabs, resize, bounded scrollback,
  reconnect, search, copy and paste, activity state, and exit reporting.
- Start terminals in the workspace with the user's shell and support explicitly
  trusted direnv environments.
- Start Neovim clean by default, or explicitly load the user's `init.lua`, then
  attach with `--embed` as an external UI and forward redraw, input, clipboard,
  and resize events.
- Prefer maintained terminal, PTY, Neovim RPC, and rendering libraries over
  custom implementations.
- Add LSP-backed CodeMirror features later; do not build a second
  language-server manager before the Neovim path works.

### Resources

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

### Resource use

- Show current and peak resource use for Pau and each managed process tree,
  including Pi, Claude, terminals, Neovim, and stdio MCP servers.
- Report CPU, resident memory, process count, elapsed time, and disk I/O where
  the operating system exposes it reliably.
- Keep a short local history and a final session summary. Do not retain raw
  samples indefinitely or send telemetry to a remote service.
- Warn about sustained resource pressure and offer interrupt or stop controls.
  Do not throttle or terminate work automatically by default.
- Keep model context, token, and cost usage separate from machine resource use.

### Permission controls

- Keep permission prompting off by default. Offer profiles for no prompts,
  confirming writes and commands, and confirming mutating or open-network
  operations.
- Show permission controls only when the adapter can allow or deny an operation
  before it executes. Never present observation after execution as approval.
- Allow workspace reads except for protected sensitive paths. Ask before reads
  outside the workspace and deny high-confidence credential and authentication
  paths by default. Only a user-scoped rule may relax a default sensitive-path
  restriction; project configuration may only narrow access.
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

### Desktop and web

- The Tauri app starts the same Axum application used by server mode.
- A CLI command starts browser mode and prints its URL.
- The interface uses HTTP for request/response operations and a WebSocket for
  live events.
- Reconnecting clients receive a snapshot followed by events newer than a
  supplied sequence number.
- Server mode binds to loopback by default. Non-loopback binding requires
  explicit authentication configuration and a warning.

## Safety requirements

- Canonicalize file paths in Rust and reject paths outside configured workspace
  roots.
- Never expose agent credentials, environment variables, or auth files through
  general file endpoints.
- Use an unguessable per-launch token for the local desktop API.
- Require authentication for WebSocket upgrades as well as HTTP requests.
- Keep destructive process, worktree, package, and file operations explicit.
- Keep sandboxing off by default. Store a workspace default with a per-session
  override and show the effective filesystem, network, credential, and process
  policy before launch.
- When enabled, start with workspace-write access, a dedicated writable temporary
  directory, protected agent and repository configuration, blocked sensitive
  credentials, and network access off. Require explicit paths and destinations
  for broader access and never fall back to unsandboxed execution silently.
- Keep the agent host and its model credentials outside the command sandbox. Run
  supported model-initiated file, search, and command tools in a separate
  sandboxed tool host whose descendants inherit the same restrictions. Disable
  tools without a proven execution boundary while a sandbox profile is active.
- Apply containment to supported model-initiated tools and their descendants,
  including stdio MCP servers. Operator terminals and Neovim remain unsandboxed
  by default and require a separate explicit sandbox selection.
- Include opt-in credential brokerage for sandboxed tools. Give a tool a
  per-session placeholder instead of the credential and replace it only on
  encrypted requests to explicitly configured destinations. Never broker model
  provider credentials, inject credentials over plaintext, or expose real values
  in process arguments, UI events, diagnostics, or logs. Deny the credential
  when the source, destination, proxy, or substitution cannot be verified.
- Label unsandboxed permission controls as guardrails rather than sandboxing.
- Record process exit status and adapter errors without mixing diagnostic output
  into protocol streams.

## Persistence

SQLite stores workspace registrations, UI preferences, process metadata,
completed-process resource summaries, event sequence checkpoints, and resource
indexes. Raw resource samples remain in bounded memory. `tokio-rusqlite`
provides the initial asynchronous access layer through one serialized
connection; pooling requires measured contention. Native Pi and third-party
session files remain authoritative. The database may cache transcript
projections for search, but deleting the cache must not delete agent history.

## First-release themes

Ship Eldritch, Nord, Iceberg, Catppuccin Mocha, and Vitesse Dark. A theme covers
the application shell, semantic states, syntax highlighting, terminal ANSI
colors, CodeMirror, and optional Neovim highlights. Applying an app theme to
Neovim requires explicit opt-in and must not silently load or replace the user's
Neovim configuration.

## Non-goals for the first release

- Cloud sandboxes or hosted execution
- Remote machine control before a separate transport and security design is
  complete
- Multiplayer editing
- Autonomous agent councils
- A visual workflow language
- Reimplementing Git, Neovim, Pi, or an LSP client in the frontend
- Normalizing every agent event into a false lowest-common-denominator model
