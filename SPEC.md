# Product specification

## Purpose

The app gives one operator a single place to run coding agents, inspect their work, edit files, and use a terminal. It targets developers who work across several repositories and want concurrent agents without hiding the underlying processes or files.

Pi is the reference implementation. Other agents are supported where their CLIs expose enough control to provide a reliable adapter.

## Core concepts

### Workspace

A local directory or Git worktree. A workspace owns terminals, editor state, and agent sessions. The app must not assume that one repository has only one active workspace.

### Agent session

A long-lived process and its native persisted conversation. A session has an adapter, workspace, status, capabilities, and ordered event stream. The agent's own files remain the source of truth for conversation history.

Statuses are `starting`, `idle`, `running`, `waiting`, `stopping`, `stopped`, and `failed`.

### Adapter

An implementation for one agent protocol. Every adapter reports capabilities rather than relying on product-wide assumptions. Initial capabilities include:

- start, resume, stop, and interrupt;
- prompt, steer, and follow up;
- streamed text and structured tool events;
- model and thinking-level selection;
- session branching or forking;
- permission requests;
- resource discovery and reload.

Unsupported controls are hidden or disabled with an explanation.

### Resource

A skill, Pi extension or package, prompt template, MCP server configuration, or agent-specific plugin. Scope is explicit: user, workspace, or project. The app shows the file or command it will change before applying an update.

## Required workflows

### Workspaces and sessions

- Open a directory and remember it.
- Create or attach a Git worktree.
- Start multiple sessions in one or more workspaces.
- Switch views without stopping background work.
- Resume native sessions discovered on disk.
- Send a prompt, queue a follow-up, steer a running Pi session, interrupt it, and inspect failures.
- Show activity and attention-required states without requiring the session view to stay open.
- Reconnect the UI after a desktop reload or browser disconnect.

### Agent support

- Pi uses structured RPC mode and retains Pi's session, branching, compaction, tools, and extension behavior.
- Claude Code, Codex, and Antigravity run through separate adapters. Each adapter prefers a documented structured protocol and falls back to a PTY only for terminal interaction.
- Raw PTY sessions remain available as an escape hatch, but terminal scraping is not presented as structured tool state.

### Editor and terminal

- Browse workspace files with ignored and hidden files handled predictably.
- Open and save text files in CodeMirror.
- Show Git diffs and changed-file state.
- Run persistent PTY terminals with resize, reconnect, and exit reporting.
- Start Neovim with `--embed`, attach as an external UI, and forward redraw, input, clipboard, and resize events.
- Add LSP-backed CodeMirror features later; do not build a second language-server manager before the Neovim path works.

### Resources

- Discover Pi skills, extensions, prompts, themes, and packages from their normal user and project locations.
- Validate skill metadata and show Pi discovery warnings.
- Install, remove, enable, disable, and update Pi packages through Pi's own package commands or supported APIs.
- Edit resource files without silently rewriting unrelated settings.
- Manage MCP configuration per agent because configuration and capabilities differ by agent.
- Treat extensions, packages, skills with scripts, and MCP servers as executable or instruction-bearing code. Show source and scope before trust is granted.

### Desktop and web

- The Tauri app starts the same Axum application used by server mode.
- A CLI command starts browser mode and prints its URL.
- The interface uses HTTP for request/response operations and a WebSocket for live events.
- Reconnecting clients receive a snapshot followed by events newer than a supplied sequence number.
- Server mode binds to loopback by default. Non-loopback binding requires explicit authentication configuration and a warning.

## Safety requirements

- Canonicalize file paths in Rust and reject paths outside configured workspace roots.
- Never expose agent credentials, environment variables, or auth files through general file endpoints.
- Use an unguessable per-launch token for the local desktop API.
- Require authentication for WebSocket upgrades as well as HTTP requests.
- Keep destructive process, worktree, package, and file operations explicit.
- Label permission controls as guardrails unless the process runs inside an actual sandbox.
- Record process exit status and adapter errors without mixing diagnostic output into protocol streams.

## Persistence

SQLite stores workspace registrations, UI preferences, process metadata, event sequence checkpoints, and resource indexes. Native Pi and third-party session files remain authoritative. The database may cache transcript projections for search, but deleting the cache must not delete agent history.

## Non-goals for the first release

- Cloud sandboxes or hosted execution
- Multiplayer editing
- Autonomous agent councils
- A visual workflow language
- Reimplementing Git, Neovim, Pi, or an LSP client in the frontend
- Normalizing every agent event into a false lowest-common-denominator model
