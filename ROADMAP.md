# Roadmap

Each milestone must leave a runnable product slice. Later milestones may change after testing the earlier ones.

## 0. Foundation

- Create Cargo and pnpm workspaces.
- Add SvelteKit static output, Axum, Tauri 2, shared wire types, and SQLite migrations.
- Serve one frontend through Tauri and `serve` mode.
- Add loopback authentication, health and version endpoints, structured logs, and CI checks.

Exit: desktop and browser modes show the same connected application shell.

## 1. Pi session loop

- Discover the Pi executable and report diagnostics.
- Implement a supervised Pi RPC process and JSONL framing.
- Start and resume sessions for a workspace.
- Stream assistant text, thinking, tool calls, tool results, and lifecycle state.
- Prompt, follow up, steer, interrupt, switch model, and stop.
- Restore UI state after reconnect.

Exit: two Pi sessions can run concurrently in different workspaces while the operator switches between them.

## 2. Workspace tools

- Add the workspace file tree, safe read/write API, file search, and Git status.
- Add CodeMirror editing and diff review.
- Add persistent PTY terminals with resize and reconnect.
- Add worktree creation and attachment without automating commits or pushes.

Exit: a Pi task can be run, inspected, edited, and tested without leaving the app.

## 3. Neovim UI

- Start and supervise `nvim --embed`.
- Implement msgpack-RPC, line-grid redraws, highlights, cursor, input, resize, and clipboard.
- Add multigrid and floating-window support after the base grid is stable.
- Reconnect the view without killing Neovim when the frontend reloads.

Exit: Neovim is usable as the primary editor for a workspace.

## 4. Pi resources

- Index user and project skills, extensions, prompts, themes, and packages.
- Show source, scope, validation errors, and trust state.
- Add create/edit/reload flows for skills and prompts.
- Add package install, update, filtering, and removal through Pi's supported commands.
- Surface extension UI requests from RPC.

Exit: common Pi customization work no longer requires manual directory navigation.

## 5. Additional agents

Add Claude Code, Codex, then Antigravity one at a time. For each adapter:

- detect installations and versions;
- ship PTY mode;
- add structured transport from documented interfaces;
- add resume and native session discovery;
- map permissions and model controls only where semantics match;
- test against fixtures and an opt-in live smoke suite.

Exit: each advertised control works for that agent; unsupported Pi features are not simulated.

## 6. MCP and language services

- Discover and edit each agent's MCP configuration without erasing unknown fields.
- Test server startup and report stderr and capability negotiation.
- Add a backend language-server supervisor for optional CodeMirror completion and diagnostics.

Exit: MCP servers and language servers can be configured and diagnosed from one place while retaining agent-specific configuration.

## Deferred

Cloud execution, remote workers, shared workspaces, agent councils, workflow graphs, mobile clients, and extension marketplaces stay out of scope until the local single-user application is reliable.
