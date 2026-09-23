# Technical plan

## Architecture

```text
┌──────────────── SvelteKit SPA ────────────────┐
│ sessions · resources · files · nvim · terminal│
└────────────────── HTTP / WS ──────────────────┘
                         │
┌──────────────────── Axum core ──────────────────┐
│ auth · state snapshots · event log · file API   │
│ workspace registry · SQLite · process registry  │
├─────────────────────────────────────────────────┤
│ Pi RPC │ CLI adapters │ PTY │ nvim msgpack-RPC  │
└───────┬────────┬─────────────┬──────────────────┘
        │        │             │
       pi    claude/codex/     nvim --embed
              antigravity
```

The Tauri binary and the server CLI both construct the same Rust application state and Axum router. Tauri is a shell and lifecycle owner, not a second backend API. The frontend must not depend on Tauri `invoke` for core behavior, which keeps browser mode real rather than a later port.

## Repository layout

```text
plugins/
  claude-bridge/       independently usable Pi package and bridge tests
apps/
  web/                 SvelteKit routes, API integration, and browser tests
  desktop/             Tauri shell, capabilities, packaging, and desktop smoke tests
packages/
  ui/                  shared Svelte components, feature views, stores, and tests
  protocol/            generated or checked TypeScript wire types
crates/
  app-core/            domain types and application services
  agent-protocol/      normalized commands, capabilities, and events
  agent-pi/            Pi RPC child-process adapter
  agent-cli/           shared process and PTY adapter support
  nvim/                embedded Neovim client and UI event mapping
  server/              Axum routes, WebSocket hub, auth, static assets
  cli/                 `serve`, diagnostics, and maintenance commands
```

`plugins/claude-bridge` ships first and remains useful without the desktop application. It establishes the Claude process protocol that the later Rust adapter consumes. `apps/web` composes the screens exported by `packages/ui` into SvelteKit routes and connects them to the local Axum API. `apps/desktop` owns the native shell and uses the web app's static output rather than maintaining another copy of the routes. Shared UI code must not import Tauri APIs; desktop-only behavior enters through explicit interfaces supplied by the app.

Start with a Cargo workspace and pnpm workspace. Split a crate only when it owns a process/protocol boundary or would otherwise create circular dependencies. Keep package boundaries similarly concrete: reusable UI and its component tests belong in `packages/ui`, while routing, transport wiring, and integration tests belong to the app that performs them.

## Backend contracts

### Commands

HTTP handles finite operations such as opening a workspace, starting a session, reading a file, or changing settings. Commands return after validation and acceptance; long-running progress arrives as events.

### Events

Every server event has:

```text
sequence, timestamp, workspace_id?, session_id?, kind, payload
```

The event hub keeps a bounded in-memory replay window and persists only events needed for recovery or indexing. On connection, the frontend requests a state snapshot and then subscribes after the snapshot's sequence number. Slow clients are disconnected and recover through replay rather than blocking agent output.

Do not force native events into one large enum too early. Use a small stable envelope plus adapter-owned typed payloads. Promote fields into common events only when at least two adapters use the same semantics.

### Process ownership

Rust owns every child process, stdin/stdout task, cancellation token, and exit watcher. A registry maps stable session IDs to live process handles. Child shutdown is staged: protocol shutdown, interrupt, terminate, then kill after a timeout.

PTY processes use a cross-platform Rust PTY library. Structured protocols use pipes, never a PTY, so framing and diagnostics stay separate.

## Pi integration

Run one `pi --mode rpc` process per live Pi session. Implement the JSONL protocol directly in `agent-pi`; this avoids embedding Node solely to reach the TypeScript SDK. Preserve unknown fields so Pi protocol additions do not crash the bridge.

The adapter must:

- correlate command responses by ID;
- subscribe before prompting and wait for `agent_settled`, not `agent_end`;
- assemble deltas for display and replace them with authoritative `message_end` values;
- keep stderr separate as diagnostics;
- support extension UI requests;
- expose native new, switch, fork, compact, model, tool, steer, follow-up, and abort operations when advertised;
- dispose the process when the owning session stops.

Use Pi's native directories and package commands for resource management. Do not edit session JSONL as an application database.

A TypeScript sidecar remains an option only if a required feature exists in the SDK but not RPC. If introduced, it should expose the same adapter contract over framed stdio and remain replaceable.

## Claude bridge plugin

The first deliverable is a Pi package that controls Claude Code through a structured bridge. It must work from Pi before the desktop application exists and expose the smallest useful lifecycle: detect Claude, start or resume a session, send work, stream events, interrupt work, and stop the child process. Claude's native session identifier and transcript remain authoritative.

Keep process control separate from Pi-facing commands and tools. The bridge writes versioned framed events, keeps diagnostics off the protocol stream, and reports capabilities explicitly. Capture protocol fixtures and use a fake Claude executable for default tests. Live Claude tests remain opt-in.

The desktop adapter later consumes the same bridge contract instead of growing a second Claude integration. Protocol changes therefore start in the plugin fixtures and compatibility tests.

## Other agent adapters

Build each adapter from captured protocol fixtures and capability tests. Prefer documented machine-readable modes. The shared CLI layer supplies process discovery, environment construction, cancellation, logging, and optional PTY transport; it must not parse terminal escape output into invented structured events.

Adapter support is graduated:

1. installed binary detection and version reporting;
2. interactive PTY session;
3. structured prompt and event streaming;
4. native resume and session discovery;
5. permissions, tools, models, and branching where supported.

The UI displays the supported level.

## Neovim and editor

The Neovim path is a real external UI:

1. Rust starts `nvim --embed` in the workspace.
2. The backend speaks msgpack-RPC and calls `nvim_ui_attach` with line-grid capabilities.
3. Redraw batches are translated to compact WebSocket events.
4. The browser renders grids on canvas or a carefully measured DOM layer and sends keyboard, mouse, paste, focus, and resize input back.
5. Clipboard and file-open requests cross explicit backend APIs.

Implement the base line grid before multigrid, floating windows, or GUI font shaping. Keep the renderer behind a frontend interface so it can move from DOM to canvas without changing the Rust protocol.

CodeMirror handles quick edits, read-only previews, and diffs. Neovim is the primary full editor. LSP support for CodeMirror is optional and should reuse a backend language-server supervisor rather than run servers in the browser.

## Frontend

Use SvelteKit in static SPA mode. `packages/ui` owns reusable components and feature-level views, with no knowledge of SvelteKit routing or Tauri. `apps/web` composes those views into routes, wires the API client and event stream, and produces the static assets consumed by both Axum and Tauri.

Keep server state in shared feature stores fed by snapshot and event reducers. Routes should be deep-linkable:

```text
/workspaces/:workspaceId/sessions/:sessionId
/workspaces/:workspaceId/editor
/workspaces/:workspaceId/resources
/settings
```

The main operating view uses a workspace/session rail, one central task surface, and an optional inspector for tool calls, diffs, and permissions. Avoid a dashboard-first design; opening the app should return the operator to active work.

## Web and desktop security

Desktop startup binds Axum to an ephemeral loopback port and supplies a random bearer token to the webview. During desktop development, the same UI may run in a normal browser against this local endpoint. This browser workflow is a development aid, not the standalone web-server deliverable. Tokens must not be written to normal logs.

The standalone web server ships after the desktop application. It serves the built UI, owns process lifetime without Tauri, and defaults to loopback with a tokenized URL. Remote access is a separate mode with an explicit listen address and configured authentication. TLS should terminate in a documented reverse proxy until the product has a reason to own certificates. The UI must state that authenticated users can run commands with the server account's privileges.

## Testing

- Rust unit tests cover framing, reducers, path authorization, process transitions, and adapter capability mapping.
- Protocol fixture tests replay recorded stdout/stderr without launching paid agents.
- Backend integration tests launch fake JSONL agents and verify start, prompt, interrupt, malformed frames, and reconnect behavior.
- `packages/ui` contains component tests for its views, stores, event reduction, and interaction states.
- `apps/web` contains integration tests for route composition, API wiring, reconnect behavior, and browser-visible workflows.
- Playwright runs from `apps/web` against fake adapters and covers the browser flow consumed by both web and desktop builds.
- `apps/desktop` keeps a small native smoke suite for startup, backend lifecycle, and asset loading instead of duplicating web integration tests.
- Real-agent smoke tests are opt-in and never part of the default test command.
