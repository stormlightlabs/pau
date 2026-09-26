# Architecture and conventions

## Architecture

```text
┌──────────────── SvelteKit SPA ─────────────────┐
│ sessions · resources · files · editor · terminal│
└─────────────────── HTTP / WS ──────────────────┘
                          │
┌──────────────────── Axum core ──────────────────┐
│ auth · state snapshots · event log · file API   │
│ workspace registry · SQLite · process registry  │
├─────────────────────────────────────────────────┤
│ Pi RPC │ CLI adapters │ PTY │ editor launch     │
└───────┬────────┬─────────────┬──────────────────┘
        │        │             │
       pi    claude/codex/     vim/nvim/hx/code/zed
              antigravity
```

The Tauri binary and the server CLI both construct the same Rust application
state and Axum router. Tauri is a shell and lifecycle owner, not a second
backend API. The frontend must not depend on Tauri `invoke` for core behavior,
which keeps browser mode real rather than a later port.

## Repository layout

```text
apps/
  web/                 SvelteKit product routes, API integration, and browser tests
  desktop/             Tauri shell, capabilities, packaging, and desktop smoke tests
  website/             SvelteKit website and product documentation
packages/
  claude-bridge/       independently usable Pi package and bridge tests
  prototype/           static design sandbox, screen fixtures, and screenshots
  ui/                  shared Svelte components, feature views, stores, and tests
  protocol/            generated or checked TypeScript wire types
crates/
  core/                pau-core: domain types, persistence, and application services
  agent/               pau-agent: agent contracts, events, and shared supervision
  pi/                  pau-pi: Pi RPC child-process adapter
  cli/                 pau-cli: executable, diagnostics, and maintenance commands
  server/              pau-server: Axum API, WebSocket hub, auth, and static assets
  term/                pau-term: PTY sessions and terminal process supervision
```

`packages/claude-bridge` ships first and remains useful without the desktop
application. It establishes the Claude process protocol that the later Rust
adapter consumes. `apps/web` composes the product screens exported by
`packages/ui` into SvelteKit routes and connects them to the local Axum API.
`apps/desktop` owns the native shell and uses the web app's static output rather
than maintaining another copy of the routes. `apps/website` is the public site
and documentation application; it may reuse suitable primitives and tokens from
`packages/ui`, but it does not import product stores or API integration. Shared
UI code must not import Tauri APIs; desktop-only behavior enters through
explicit interfaces supplied by the app.

Start with a Cargo workspace and pnpm workspace. The crate directory and Cargo
package names are fixed as shown above. `pau-core` contains no concrete agent,
terminal, server, or CLI implementation. `pau-agent` defines the adapter
boundary shared by `pau-pi` and later agents. `pau-term` owns PTYs and terminal
process supervision. External editor launch uses narrow application services
and does not expose editor-specific types through the wire protocol. `pau-server`
composes application services for HTTP and WebSocket clients, while `pau-cli`
constructs the runnable process.

Keep package boundaries similarly concrete: reusable UI and its component tests
belong in `packages/ui`, while routing, transport wiring, and integration tests
belong to the app that performs them. `packages/prototype` is an independent
static SvelteKit sandbox for screen-level design work. It owns copies of the
design tokens, fonts, icons, fixed fixtures, and screenshot scripts it needs and
does not import product applications or `packages/ui`.

## Project conventions

Pau is dual-licensed under MIT or Apache-2.0. Published JavaScript packages use
the `@stormlightlabs/pau-*` namespace. The executable and configuration name is
`pau`, and the Tauri bundle identifier is `org.stormlightlabs.pau`.

Development follows current stable releases of Pi, Claude Code, Node.js, Rust,
and supported operating systems. Known editor launch adapters follow current
stable releases of their editors. Pin exact dependency versions in
lockfiles and record versions exercised by a release. Add minimum-version
guarantees only after compatibility evidence justifies them.

Rust owns the wire types. Generate the checked TypeScript contract in
`packages/protocol` from Rust and fail CI when regeneration changes committed
output. Select the generator during the workspace scaffold rather than
maintaining parallel handwritten types.

Use `tokio-rusqlite` for the initial SQLite access layer. One opened connection
has one background thread; cloned handles queue work onto that connection, so
this is asynchronous serialization rather than a connection pool. Start with one
connection, WAL mode, a busy timeout, and short transactions. Add read
connections or a pool only if measurements show contention.
