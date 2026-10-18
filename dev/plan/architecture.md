# Architecture and conventions

## Architecture

```text
┌──────────── Desktop app ────────────┐  ┌──────── Remote web app ────────┐
│ SvelteKit routes · native services  │  │ SvelteKit routes · remote auth │
└────────────── HTTP / WS ────────────┘  └────────── HTTP / WS ───────────┘
                    │                                  │
                    └──────────────┬───────────────────┘
                                   │
┌──────────────────────────── Axum core ──────────────────────────────┐
│ auth · state snapshots · event log · file API · process registry   │
├─────────────────────────────────────────────────────────────────────┤
│ Pi RPC │ CLI adapters │ PTY │ editor launch                        │
└───────┬────────┬─────────────┬──────────────────────────────────────┘
        │        │             │
       pi    claude/codex/     vim/nvim/hx/code/zed
              antigravity
```

The desktop app owns the primary local product composition. Its Tauri process
constructs the Rust application state and Axum router, serves the desktop
frontend, owns native lifecycle, and supplies desktop-only capabilities through
narrow interfaces. The desktop frontend may run in a normal browser during
development, but that development path remains part of `apps/desktop`.

The later web app is a separate browser composition for a standalone Pau server.
It reuses protocol types and suitable UI features without assuming that every
native desktop capability is remotely available. Both application owners use
the same Axum service contracts where their capabilities overlap. Core behavior
still uses HTTP and WebSocket rather than Tauri `invoke`; native window, dialog,
notification, update, and operating-system integration may use explicit Tauri
interfaces.

## Repository layout

```text
apps/
  desktop/             local SvelteKit product, Tauri shell, native capabilities, and desktop tests
  web/                 remote SvelteKit product, authentication, API integration, and browser tests
  website/             SvelteKit website and product documentation
packages/
  claude-bridge/       independently usable Pi package and bridge tests
  ui/                  shared Svelte components, feature views, stores, and tests
  protocol/            generated or checked TypeScript wire types
  sandbox/             sandbox launcher, Pi tool host, and containment fixtures
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
adapter consumes. `apps/desktop` composes the local product screens exported by
`packages/ui`, connects them to its loopback Axum API, and owns native lifecycle
and capability interfaces. `apps/web` later composes the remote browser product
against the standalone server. It may reuse feature views, but it owns remote
authentication, connection recovery, and capability gating rather than importing
the desktop route tree.

`apps/website` is the public site and documentation application; it may reuse
suitable primitives and tokens from `packages/ui`, but it does not import
product stores or API integration. Shared UI code must not import Tauri APIs.
Desktop-only behavior enters through interfaces supplied by `apps/desktop`, and
remote-only behavior remains in `apps/web`.

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
belong to the app that performs them. Screen-level design work lives in the
OpenPencil file `pau.fig` and the static HTML screens in `dev/prototype`,
outside the code workspaces.

## Project conventions

Pau is dual-licensed under MIT or Apache-2.0. Published JavaScript packages use
the `@stormlightlabs/pau-*` namespace. The executable and configuration name is
`pau`, and the Tauri bundle identifier is `org.stormlightlabs.pau`.

Development follows current stable releases of Pi, Claude Code, Node.js, Rust,
and supported operating systems. Known editor launch adapters follow current
stable releases of their editors. Pin exact dependency versions in
lockfiles and record versions exercised by a release. Add minimum-version
guarantees only after compatibility evidence justifies them.

The Cargo workspace version is the desktop app's only version source. Each
completed batch of roadmap work raises the minor version and receives an
annotated `vX.Y.0` tag. Fixes found while using a tagged build raise the
patch version. Only tagged builds are installed for dogfooding. Untagged builds
report a `-dev` version with the commit, use the `org.stormlightlabs.pau.dev`
bundle identifier and the product name "Pau Dev", and keep their own data
directory so they never migrate the installed app's database. Before 1.0.0,
migrations only move forward, and the app refuses to open a database whose
schema is newer than its own. From 1.0.0, every migration also has a down
migration so an installed release can return to an earlier version.

Rust owns the wire types. Generate the checked TypeScript contract in
`packages/protocol` from Rust and fail CI when regeneration changes committed
output. Select the generator during the workspace scaffold rather than
maintaining parallel handwritten types.

Use `tokio-rusqlite` for the initial SQLite access layer. One opened connection
has one background thread; cloned handles queue work onto that connection, so
this is asynchronous serialization rather than a connection pool. Start with one
connection, WAL mode, a busy timeout, and short transactions. Add read
connections or a pool only if measurements show contention.
