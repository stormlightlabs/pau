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
  web/                 SvelteKit product routes, API integration, and browser tests
  desktop/             Tauri shell, capabilities, packaging, and desktop smoke tests
  website/             SvelteKit website and product documentation
packages/
  ui/                  shared Svelte components, feature views, stores, and tests
  protocol/            generated or checked TypeScript wire types
crates/
  core/                pau-core: domain types, persistence, and application services
  agent/               pau-agent: agent contracts, events, and shared supervision
  pi/                  pau-pi: Pi RPC child-process adapter
  cli/                 pau-cli: executable, diagnostics, and maintenance commands
  server/              pau-server: Axum API, WebSocket hub, auth, and static assets
  term/                pau-term: PTY sessions and embedded Neovim integration
```

`plugins/claude-bridge` ships first and remains useful without the desktop application. It establishes the Claude process protocol that the later Rust adapter consumes. `apps/web` composes the product screens exported by `packages/ui` into SvelteKit routes and connects them to the local Axum API. `apps/desktop` owns the native shell and uses the web app's static output rather than maintaining another copy of the routes. `apps/website` is the public site and documentation application; it may reuse suitable primitives and tokens from `packages/ui`, but it does not import product stores or API integration. Shared UI code must not import Tauri APIs; desktop-only behavior enters through explicit interfaces supplied by the app.

Start with a Cargo workspace and pnpm workspace. The crate directory and Cargo package names are fixed as shown above. `pau-core` contains no concrete agent, terminal, server, or CLI implementation. `pau-agent` defines the adapter boundary shared by `pau-pi` and later agents. `pau-term` owns both PTYs and Neovim because they share process, input, resize, and reconnect concerns. `pau-server` composes application services for HTTP and WebSocket clients, while `pau-cli` constructs the runnable process.

Keep package boundaries similarly concrete: reusable UI and its component tests belong in `packages/ui`, while routing, transport wiring, and integration tests belong to the app that performs them.

## Dependency policy

Use maintained libraries for protocol, terminal, editor, and rendering work before writing equivalents. Prefer small libraries with stable wire or platform boundaries over adopting an IDE framework. Record the version, license, maintenance state, and the missing requirement that justifies any custom implementation.

The initial choices to validate are:

- `@xterm/xterm` and official addons for terminal emulation, fitting, search, serialization, links, clipboard, Unicode, and optional WebGL rendering;
- `portable-pty` for Rust PTY ownership on Linux and macOS;
- CodeMirror 6 for lightweight editing and diff views;
- `nvim-rs` or another maintained Rust client for Neovim msgpack-RPC;
- an existing embeddable Neovim web UI or grid renderer, if one meets current Neovim UI protocol, input, theming, and reconnect requirements;
- Iconify through UnoCSS or unplugin for the selected icon sets.

Do a short dependency spike before implementing the Neovim renderer. Existing native GUIs are useful references but do not qualify if they cannot embed in both Tauri's webview and a browser. If no maintained embeddable renderer fits, build only the thin grid and input layer above an existing RPC client; do not implement msgpack-RPC or text shaping from scratch.

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

Run one `pi --mode rpc` process per live Pi session. Implement the JSONL protocol directly in `pau-pi`; this avoids embedding Node solely to reach the TypeScript SDK. Preserve unknown fields so Pi protocol additions do not crash the bridge.

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

Build each adapter from captured protocol fixtures and capability tests. Prefer documented machine-readable modes. `pau-agent` supplies shared process discovery, environment construction, cancellation, and logging; `pau-term` supplies PTY transport. Neither may parse terminal escape output into invented structured agent events.

Adapter support is graduated:

1. installed binary detection and version reporting;
2. interactive PTY session;
3. structured prompt and event streaming;
4. native resume and session discovery;
5. permissions, tools, models, and branching where supported.

The UI displays the supported level.

## Terminal

The terminal is a first-class workspace surface, not a shell-command text box. Rust owns each PTY and its child process through `portable-pty`, subject to the dependency spike. The browser uses `@xterm/xterm` and its official addons from `packages/ui`; it never talks directly to a local process. We will configure and compose these libraries rather than write a terminal emulator.

A terminal session has a stable ID, workspace, shell command, dimensions, title, status, and attachment count. Opening a terminal uses the user's interactive shell in the workspace directory. The environment can inherit the backend process, use a login shell, or run through an explicitly enabled workspace environment such as `direnv exec`. The app must not source an `.envrc` itself or bypass direnv's trust decision.

WebSocket binary frames carry input and output; typed control messages handle create, attach, resize, signal, detach, and close. Output tasks must apply bounded backpressure so a noisy command cannot exhaust server memory. The backend retains bounded scrollback for reattachment and marks a replay as partial if older bytes were discarded. PTYs survive route changes and browser disconnects until the user closes them, the process exits, or a configured idle policy applies.

The UI supports multiple named terminal tabs, accurate resize, copy and paste, selection, search, links, bell and activity state, exit status, and keyboard-only operation. It uses xterm.js's canvas renderer first and treats WebGL as an optional measured optimization. OSC links and file paths are parsed conservatively and never execute commands on click.

In the workspace layout, terminals can occupy the main surface or a resizable bottom dock. A narrow viewport uses a full-surface terminal rather than compressing it beside the workspace and review rails. Neovim may run in a terminal as an escape hatch, but the embedded Neovim UI remains a separate primary editor path.

## Neovim and editor

The Neovim path is a real external UI:

1. Rust starts `nvim --embed` in the workspace.
2. A maintained RPC library speaks msgpack-RPC and calls `nvim_ui_attach` with line-grid capabilities.
3. Redraw batches are translated to compact WebSocket events.
4. An existing embeddable web renderer handles grids and input when the dependency spike finds a suitable one; otherwise the browser supplies a thin canvas or DOM grid layer.
5. Clipboard and file-open requests cross explicit backend APIs.

Implement or adopt the base line grid before enabling multigrid, floating windows, or GUI font shaping. Keep the renderer behind a frontend interface so a library or rendering strategy can change without changing the Rust protocol.

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

## Design direction

The references in `dev/design/` guide the whole application rather than isolated screens. This is an operating interface: dense, dark by default, flat, and divided by alignment and restrained borders rather than nested cards. Theme support is structural, so palette values become semantic tokens rather than component-local values.

The first release ships Eldritch, Nord, Iceberg, Catppuccin Mocha, and Vitesse Dark. Each theme defines application surfaces and text, semantic states, syntax colors, the terminal's ANSI palette, CodeMirror highlighting, and Neovim highlight mappings. Source the palettes from their upstream projects and retain required licenses and attribution. The optional “Apply theme to Neovim” setting changes highlights only after explicit opt-in; loading the user's `init.lua` and overriding its colors remain separate choices.

The wide layout has a persistent product rail, a contextual workspace or section rail, one main task surface, and an optional right inspector. The command bar stays globally available. The main surface switches among conversation, editor, Neovim, terminal, and resource views; the inspector holds review, plan, checks, permissions, or selected-resource detail. The terminal bottom dock is the only surface that may share the main column vertically.

Use a legible UI sans for navigation and prose and a dedicated monospace face for code, paths, terminal content, changing counters, and agent output where alignment matters. Preserve the compact rhythm in the mockups while keeping interactive targets large enough through invisible padding and keyboard access.

Follow `dev/design/icons.md`: Tabler for general interface actions, Octicons for Git, Catppuccin for file types, and Simple Icons for named services. Load icons through UnoCSS's icon preset or an equivalent build-time Iconify integration. Every icon-only control needs an accessible name, and state must not rely on icon shape or color alone.

At narrower widths, collapse the contextual rail before the product rail, move the inspector to an overlay or full view, and let editor, Neovim, and terminal surfaces use all available space. Do not shrink the three-column desktop composition until its text and controls no longer fit.

## Website and documentation

`apps/website` follows the SvelteKit documentation patterns used in Inkfinite, Dalil, Stormbuffer, and Mire. It is a separate static site because `apps/web` is an authenticated product surface rather than the public entry point.

Use mdsvex content under `apps/website/src/content/docs`, validated frontmatter, generated navigation and tables of contents, Shiki highlighting, and Pagefind search. Prerender documentation pages and expose useful machine-readable routes: raw Markdown for each page, `llms.txt`, `sitemap.xml`, `robots.txt`, and Open Graph images. Keep the content layer small enough to understand locally instead of adopting a general documentation framework.

Reuse presentational pieces from `packages/ui` when they fit the website, including icons, buttons, theme tokens, code treatment, and small controls. Keep the documentation shell, prose styles, search, navigation, SEO, and content loaders in `apps/website`; these serve a reading surface and should not pull agent state or dense application layout into the site.

Documentation changes belong to the same unit of work as the behavior they describe. Document only working behavior. Each page should answer one task or concept, start with the useful fact or instruction, include commands that can be copied, and link to deeper detail instead of repeating it. The initial information architecture covers installation, quickstart, Claude bridge, desktop use, workspaces and sessions, terminal and Neovim, resources and MCP, server deployment, security, configuration reference, architecture, and contributing.

The website build validates frontmatter, internal links, heading structure, code examples that can be checked without credentials, raw Markdown routes, and search indexing. Browser tests cover global navigation, documentation navigation, search, copy controls, theme behavior, and narrow layouts.

## Web and desktop security

Desktop startup binds Axum to an ephemeral loopback port and supplies a random bearer token to the webview. During desktop development, the same UI may run in a normal browser against this local endpoint. This browser workflow is a development aid, not the standalone web-server deliverable. Tokens must not be written to normal logs.

The standalone web server ships after the desktop application. It serves the built UI, owns process lifetime without Tauri, and defaults to loopback with a tokenized URL. Remote access is a separate mode with an explicit listen address and configured authentication. TLS should terminate in a documented reverse proxy until the product has a reason to own certificates. The UI must state that authenticated users can run commands with the server account's privileges.

## Testing

- Rust unit tests cover framing, reducers, path authorization, process transitions, and adapter capability mapping.
- Protocol fixture tests replay recorded stdout/stderr without launching paid agents.
- Backend integration tests launch fake JSONL agents and verify start, prompt, interrupt, malformed frames, and reconnect behavior.
- PTY integration tests cover input, output, resize, exit, noisy-process backpressure, detach, replay, and cleanup.
- `packages/ui` contains component tests for its views, stores, event reduction, terminal lifecycle, theme contracts, and interaction states.
- `apps/web` contains integration tests for route composition, API wiring, reconnect behavior, and browser-visible workflows.
- `apps/website` tests content validation, internal links, raw Markdown routes, search, documentation navigation, and responsive reading layouts.
- Playwright runs from `apps/web` against fake adapters and covers the browser flow consumed by both web and desktop builds.
- `apps/desktop` keeps a small native smoke suite for startup, backend lifecycle, and asset loading instead of duplicating web integration tests.
- Real-agent smoke tests are opt-in and never part of the default test command.
