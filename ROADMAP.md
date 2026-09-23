# Roadmap

Work ships as three deliverables in this order. Each deliverable must remain independently usable and leave fixtures and contracts for the next one.

## 1. Claude bridge plugin

Build an independently installable Pi package before starting the desktop application.

### Bridge foundation

- Define a versioned framed protocol for commands, responses, lifecycle events, and diagnostics.
- Detect the Claude Code executable and report its version and supported bridge capabilities.
- Start or resume a Claude session in a selected working directory.
- Send work, stream structured output, interrupt the active turn, and stop the process.
- Preserve Claude's native session identifier and files as the source of truth.

### Pi integration

- Expose the bridge through focused Pi tools or commands without coupling process control to terminal UI rendering.
- Report background state and failures to Pi.
- Clean up child processes on session shutdown, reload, and cancellation.
- Document installation, trust implications, and supported Claude versions.

### Verification

- Test framing, malformed messages, process exits, interruption, and restart against a fake Claude executable.
- Store representative protocol fixtures for the later Rust adapter.
- Keep paid, live-Claude smoke tests opt-in.

Exit: Pi can start, control, and observe Claude Code through the plugin without the desktop app.

## 2. Desktop app and development web UI

The SvelteKit app must run in a normal browser during development, but Tauri is the shipped application in this deliverable.

### Foundation

- Create Cargo and pnpm workspaces with `apps/web`, `apps/desktop`, `packages/ui`, and the Rust crates.
- Add the SvelteKit static build, shared UI package, embedded Axum API, Tauri 2 shell, and SQLite migrations.
- Add loopback authentication, health and version endpoints, structured logs, and CI checks.
- Compose routes and integration tests in `apps/web`; keep components and component tests in `packages/ui`.

### Agent session loop

- Discover Pi and implement its supervised RPC process and JSONL framing.
- Start and resume multiple Pi sessions across workspaces.
- Stream assistant text, thinking, tool calls, tool results, and lifecycle state.
- Prompt, follow up, steer, interrupt, switch model, and stop.
- Add a Rust Claude adapter that consumes the bridge contract and fixtures from deliverable 1.
- Restore UI state after a frontend reload.

### Workspace tools

- Add the workspace file tree, safe read/write API, file search, and Git status.
- Add CodeMirror editing and diff review.
- Add persistent PTY terminals with resize and reconnect.
- Add worktree creation and attachment without automating commits or pushes.

### Neovim UI

- Start and supervise `nvim --embed`.
- Implement msgpack-RPC, line-grid redraws, highlights, cursor, input, resize, and clipboard.
- Add multigrid and floating-window support after the base grid is stable.
- Reconnect the view without killing Neovim when the frontend reloads.

### Pi resources

- Index user and project skills, extensions, prompts, themes, and packages.
- Show source, scope, validation errors, and trust state.
- Add create, edit, reload, install, update, filtering, and removal through Pi's supported interfaces.
- Surface extension UI requests from RPC.

Exit: the Tauri app can run concurrent Pi and Claude work, inspect and edit a workspace, use a terminal, and use Neovim. The same UI works in a browser against the local development backend.

## 3. Web server

Turn the local backend and static frontend into a standalone process without creating a second application stack.

### Local server mode

- Add a CLI command that serves the built UI and API without Tauri.
- Own agent, terminal, and Neovim process lifetimes across browser disconnects.
- Print a tokenized loopback URL and support clean shutdown and restart recovery.
- Run the existing `apps/web` integration and Playwright suites against server mode.

### Remote access

- Require explicit configuration for non-loopback binding.
- Add durable authentication, origin checks, session expiry, and audit events.
- Document TLS termination through a reverse proxy.
- State clearly that authenticated users can execute commands with the server account's privileges.

### Remaining integrations

- Add Codex and Antigravity adapters one at a time from documented protocols and captured fixtures.
- Discover and edit each agent's MCP configuration without erasing unknown fields.
- Test MCP server startup and report stderr and capability negotiation.
- Add an optional backend language-server supervisor for CodeMirror.

Exit: the same application can run as a local or explicitly secured remote web service without Tauri.

## Deferred

Cloud execution, remote workers, shared workspaces, agent councils, workflow graphs, mobile clients, and extension marketplaces stay out of scope until the three deliverables are reliable.
