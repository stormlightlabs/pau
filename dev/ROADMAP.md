# Roadmap

Work ships as three deliverables in this order. Each numbered unit should fit in
one issue and one pull request. Its verification belongs in the same pull
request. Units are ordered unless a dependency is stated explicitly.

Documentation is part of the unit that introduces or changes user-facing
behavior. Before `apps/website` exists, keep the relevant package README
accurate. After it exists, update the corresponding website page in the same
pull request. Documentation verification includes the website build,
internal-link checks, and any copyable command checks that apply to the unit.

A unit that adds or materially changes UI also adds or updates its Storybook
stories in the same pull request. Stories expose representative states without
requiring a live agent. Verification runs relevant Vitest unit and browser
component tests, Storybook interaction and accessibility tests, and Playwright
integration tests only when the behavior crosses an application boundary.

When a unit first makes a Pau surface usable, its verification includes a
self-hosted smoke run when practical. The Claude bridge is the first dogfood
surface: after unit 1.8 passes its live smoke test, use it for suitable Pau
work. Later units use working Pau surfaces during normal development without
replacing deterministic tests or widening the active unit.

### Unit metadata

Each unit has an explicit status:

- `planned`: Work has not started.
- `in progress`: Implementation is active.
- `blocked`: Work started but cannot continue. Add a short `Status note` below
  the status.
- `complete`: Implementation and the unit's verification are complete.

Update the status when work starts, becomes blocked, resumes, or completes.
Treat it as the source of truth instead of inspecting the implementation to
infer completion. A deliverable is complete only when every unit in it has
status `complete`.

Each unit also lists its direct blockers. A whole number refers to the completed
status of that deliverable; for example, `Blocked by: 1` means every unit in
deliverable 1 must be `complete`. A dotted identifier refers to one unit.
Transitive blockers are implied and are not repeated. `Blocked by: none` means
there is no dependency. A planned unit is ready when every listed blocker has
status `complete`.

## 1. Claude bridge plugin

The first deliverable is an independently installable Pi package. It must remain
useful without Pau.

### 1.1 Bridge protocol and test harness

Status: complete
Blocked by: none

Create `@stormlightlabs/pau-claude-bridge` from scratch under the repository's
MIT OR Apache-2.0 license. Define versioned framing for commands, responses,
events, and diagnostics. Add a fake Claude executable and representative
protocol fixtures.

Verification:

- Round-trip every frame type.
- Reject unsupported versions and malformed frames without losing framing for
  the next valid message.
- Confirm diagnostics never appear on the protocol stream.

### 1.2 Claude discovery

Status: complete
Blocked by: 1.1

Find the Claude Code executable, read its version, and report bridge
capabilities. Keep discovery separate from starting a session.

Verification:

- Cover configured paths, `PATH` discovery, missing binaries, non-executable
  files, and unsupported versions with fixture processes.

### 1.3 Process lifecycle

Status: complete
Blocked by: 1.1, 1.2

Start Claude in a selected working directory and stop it through a staged
shutdown. Track process state and exit information.

Verification:

- Start the fake executable in a path containing spaces.
- Confirm graceful shutdown, timeout escalation, unexpected exit reporting, and
  removal from the live-process registry.

### 1.4 Prompt and event streaming

Status: complete
Blocked by: 1.3

Send one task and translate Claude's structured output into bridge events
without parsing terminal presentation.

Verification:

- Replay fixtures containing text, tool activity, diagnostics, completion, and
  partial frames.
- Confirm event ordering and the authoritative completion state.

### 1.5 Native session resume

Status: complete
Blocked by: 1.4

Expose Claude's native session identifier and resume an existing session without
copying its transcript into plugin-owned storage.

Verification:

- Start, capture the native identifier, stop, and resume against the fake
  executable.
- Confirm an unknown or mismatched identifier returns a recoverable error.

### 1.6 Interrupt and failure recovery

Status: planned
Blocked by: 1.4

Interrupt an active turn, distinguish interruption from process failure, and
keep the session usable when Claude supports continuation.

Verification:

- Interrupt before output, during output, and during a simulated tool event.
- Cover ignored interrupts, process crashes, and a successful prompt after
  interruption.

### 1.7 Pi package integration

Status: planned
Blocked by: 1.2, 1.3, 1.4, 1.5, 1.6

Package the bridge as a Pi extension with focused commands or tools for
discovery, start, resume, prompt, status, interrupt, and stop. Keep terminal
rendering out of the bridge layer.

Verification:

- Load the package in an isolated Pi agent directory.
- Exercise every command against the fake Claude executable.
- Confirm reload and `session_shutdown` leave no child process running.

### 1.8 Packaging and live smoke test

Status: planned
Blocked by: 1.7

Document installation, configuration, supported Claude versions, and trust
implications. Add an opt-in live-Claude smoke test that is excluded from default
checks.

Verification:

- Install the packed artifact into a clean temporary Pi agent directory and run
  its fake-agent test.
- Run the opt-in live-Claude smoke test, then use the installed bridge for one
  small, bounded Pau task.
- Record any bridge failure found during that dogfood task before marking the
  unit complete.
- Confirm the default test command cannot invoke a paid Claude session.

Deliverable exit: Pi can start, control, resume, and observe Claude Code through
the package without Pau.

## 2. Desktop app and development web UI

The SvelteKit app runs in a normal browser during development. Tauri is the
shipped application in this deliverable.

### Foundation

#### 2.1 Workspace scaffold

Status: planned
Blocked by: 1

Create the pnpm workspace with `apps/web`, `apps/desktop`, `apps/website`,
`packages/ui`, and `packages/protocol`, using the `@stormlightlabs/pau-*`
package namespace. Scaffold the website with the established SvelteKit
documentation stack: mdsvex, validated content metadata, Shiki, Pagefind, raw
Markdown routes, `llms.txt`, sitemap, Open Graph output, and static deployment.
Configure `org.stormlightlabs.pau` as the Tauri bundle identifier. Create the
Cargo workspace with the required crate paths and names:

```text
crates/core    pau-core
crates/agent   pau-agent
crates/pi      pau-pi
crates/cli     pau-cli
crates/server  pau-server
crates/term    pau-term
```

Verification:

- Run pnpm formatting and type checks from the repository root.
- Build the website and confirm one fixture page appears in navigation, raw
  Markdown, `llms.txt`, sitemap, and Pagefind output.
- Generate the checked TypeScript protocol from Rust and confirm CI detects
  stale generated output.
- Run `cargo check --workspace` and confirm every package has the required name.
- Evaluate the Nix development shell on every declared system.

#### 2.2 Storybook and browser component workbench

Status: planned
Blocked by: 2.1

Set up Storybook in `packages/ui` with typed fixtures, theme and viewport
controls, reduced-motion and capability controls, accessibility checks, Vitest
integration, and Playwright-backed browser component tests. Add a root `dev:ui`
command for rapid design review.

Verification:

- Run Storybook locally with hot reload, build its static output in CI, and
  retain the build as a review artifact.
- Exercise one fixture component through a story `play` function and a dedicated
  browser component test.
- Confirm stories run without Tauri, Axum, or a live agent.
- Confirm keyboard and accessibility failures make the test command fail.

#### 2.3 Shared application shell

Status: planned
Blocked by: 2.1, 2.2

Implement the global command bar, product rail, contextual rail, main surface,
optional inspector, and narrow-layout behavior in `packages/ui`. Compose it
from `apps/web` without Tauri imports.

Verification:

- Test rail and inspector states in the UI package.
- Review Storybook stories for rail, inspector, long-content, disconnected, and
  narrow-layout states.
- Render the shell through `apps/web` at wide and narrow viewports.
- Confirm keyboard focus order and named icon-only controls.

#### 2.4 Tauri and local Axum connection

Status: planned
Blocked by: 2.1

Start `pau-server` inside the Tauri lifecycle, bind it to an ephemeral loopback
port, and load the SvelteKit static output. Let the development web app connect
to the same API shape.

Verification:

- Launch the Tauri app and browser development app against the local backend.
- Confirm both receive the same version response.
- Confirm closing Tauri stops its backend.

#### 2.5 Persistence foundation

Status: planned
Blocked by: 2.1

Add SQLite migrations and `pau-core` repositories for workspaces, application
settings, and process metadata using one `tokio-rusqlite` connection in WAL mode
with a busy timeout. Do not store native agent transcripts or add a pool without
measured contention.

Verification:

- Apply migrations to an empty database and upgrade from each checked-in
  migration state.
- Round-trip each repository type.
- Delete the database and confirm native session files remain untouched.

#### 2.6 Local API authentication and diagnostics

Status: planned
Blocked by: 2.4

Add the per-launch desktop token, authenticated HTTP and WebSocket handshakes,
health and version endpoints, and structured logs with secret redaction.

Verification:

- Reject missing and invalid tokens on HTTP and WebSocket connections.
- Confirm the desktop client connects with its launch token.
- Scan captured logs to ensure the token and configured secrets do not appear.

#### 2.7 Continuous integration

Status: planned
Blocked by: 2.1, 2.2

Run Rust formatting, linting, and tests; TypeScript formatting, type checking,
Vitest, and Playwright tests; Storybook tests and static build; the website
build and link checks; generated-contract checks; and Nix flake evaluation in
CI. Cache dependencies without caching credentials or user state.

Verification:

- Run the workflow on a clean checkout.
- Introduce one controlled failure in each toolchain while developing the
  workflow and confirm the expected job fails.

#### 2.8 Terminal dependency spike

Status: planned
Blocked by: 2.1

Validate `portable-pty`, `@xterm/xterm`, required official addons, binary
WebSocket transport, and Linux/macOS behavior with a minimal end-to-end
prototype.

Verification:

- Run an interactive shell, full-screen terminal program, resize sequence,
  Unicode input, and reconnect experiment.
- Record selected versions, licenses, limitations, and any justified custom
  layer in `dev/PLAN.md`.

#### 2.9 Neovim dependency spike

Status: planned
Blocked by: 2.1

Evaluate maintained Rust Neovim RPC clients and embeddable browser grid
renderers. Prefer an existing renderer; otherwise define the smallest grid/input
layer Pau must own.

Verification:

- Attach to `nvim --embed`, render a changed line, send input, and resize.
- Record the selected dependencies, licenses, unsupported UI events, and custom
  scope in `dev/PLAN.md`.

#### 2.10 Theme contract and bundled palettes

Status: planned
Blocked by: 2.2, 2.3

Define semantic theme tokens and add Eldritch, Nord, Iceberg, Catppuccin Mocha,
and Vitesse Dark from their upstream palettes. Include required licenses and
attribution. Add variable Fontsource packages for IBM Plex Sans, Google Sans,
and Google Sans Code to the website.

Verification:

- Validate every theme against the token schema.
- Render the application shell in all five themes through Storybook and review
  the selected visual snapshots.
- Confirm the website uses IBM Plex Sans for body text, Google Sans for headings
  and navigation, and Google Sans Code for technical text.
- Confirm the production website makes no remote font request.
- Check text, focus, status, and meaningful boundary contrast.

### Agent session loop

#### 2.11 Pi discovery and diagnostics

Status: planned
Blocked by: 2.4

Find Pi, report its version and configuration paths, and expose actionable
installation errors without starting a session.

Verification:

- Cover configured paths, `PATH` discovery, missing binaries, non-executable
  files, and unsupported versions.

#### 2.12 Pi RPC process and framing

Status: planned
Blocked by: 2.11

Implement supervised `pi --mode rpc` startup in `pau-pi`, command correlation,
JSONL framing, stderr diagnostics, and staged shutdown.

Verification:

- Test partial lines, multiple lines per read, malformed JSON, interleaved
  responses and events, stderr output, and unexpected exits against a fake Pi
  executable.

#### 2.13 Pi event projection

Status: planned
Blocked by: 2.12

Project text deltas, thinking, tool calls, tool results, and lifecycle events
into `pau-agent` events. Replace streamed projections with authoritative
completed messages.

Verification:

- Replay captured fixtures through the reducer.
- Confirm `agent_end` does not mark a session idle before `agent_settled`.

#### 2.14 Pi session controls

Status: planned
Blocked by: 2.12, 2.13

Add prompt, follow-up, steer, interrupt, model selection, and stop operations
with capability-aware errors.

Verification:

- Exercise every control against fake RPC fixtures.
- Cover invalid state transitions, including prompting while running without a
  queue choice.

#### 2.15 Concurrent session registry

Status: planned
Blocked by: 2.5, 2.12, 2.14

Run multiple Pi sessions across one or more workspaces without blocking inactive
views. Persist enough metadata to rediscover native sessions after restart.

Verification:

- Run two fake sessions concurrently and interleave their events.
- Stop one session and confirm the other remains active.
- Restart Pau and rediscover both native session records.

#### 2.16 Session UI

Status: planned
Blocked by: 2.3, 2.10, 2.14, 2.15

Build the workspace/session rail, transcript, composer, tool activity, status,
and attention-required states using `packages/ui` and compose the route in
`apps/web`.

Verification:

- Component-test empty, starting, running, waiting, failed, and stopped states.
- Run the browser flow against two fake concurrent sessions.
- Verify keyboard-only prompt, interrupt, and session switching.

#### 2.17 Snapshot and reconnect

Status: planned
Blocked by: 2.6, 2.15, 2.16

Send a state snapshot plus sequenced events so a frontend reload reconstructs
active sessions without duplicating output.

Verification:

- Disconnect during streamed text and reconnect from the last acknowledged
  sequence.
- Cover replay-window success, replay-window expiry, duplicate delivery, and
  snapshot/event boundary races.

#### 2.18 Rust Claude adapter

Status: planned
Blocked by: 1, 2.15, 2.16

Implement a `pau-agent` adapter that consumes the bridge contract and fixtures
from deliverable 1. Do not add a second Claude process protocol.

Verification:

- Run the deliverable 1 fixture suite through the Rust adapter.
- Start one Pi and one fake Claude session concurrently through the same session
  UI.

### Workspace tools

#### 2.19 Workspace registry and file access

Status: planned
Blocked by: 2.4, 2.5, 2.6

Open and remember workspace roots. Add canonicalized, root-confined file
listing, reading, writing, and search APIs.

Verification:

- Cover symlink escapes, `..` traversal, paths with non-ASCII characters,
  ignored files, hidden files, and files changed between read and write.

#### 2.20 File tree and search UI

Status: planned
Blocked by: 2.3, 2.19

Add the file tree, file-type icons, ignored/hidden-file controls, and file
search to the workspace layout.

Verification:

- Component-test loading, empty, permission-error, deep-tree, and large-result
  states.
- Verify keyboard navigation and long-path overflow at narrow and wide widths.

#### 2.21 Git status

Status: planned
Blocked by: 2.19, 2.20

Read repository and worktree status without mutating Git. Show branch and
changed-file state using Octicons and text labels.

Verification:

- Cover untracked, modified, staged, deleted, renamed, conflicted,
  detached-HEAD, and non-repository workspaces.

#### 2.22 CodeMirror editor

Status: planned
Blocked by: 2.10, 2.19, 2.20

Add text-file viewing and saving with CodeMirror 6, dirty state, external-change
detection, and the active theme's syntax colors.

Verification:

- Open, edit, save, revert, and detect an external modification.
- Cover read-only, binary, oversized, and invalid-encoding files with explicit
  states.

#### 2.23 Diff review

Status: planned
Blocked by: 2.21, 2.22

Add file and hunk diff views with changed-file navigation and review state.
Leave commit and push automation out of this unit.

Verification:

- Render additions, deletions, replacements, long lines, wrapped lines, and
  binary-file notices.
- Verify file and hunk navigation with keyboard and pointer.

#### 2.24 PTY backend

Status: planned
Blocked by: 2.4, 2.6, 2.8

Implement terminal create, attach, input, output, resize, signal, detach, close,
bounded scrollback, backpressure, and cleanup in `pau-term`.

Verification:

- Cover input/output, rapid resize, process exit, noisy output, detach and
  replay, discarded scrollback, and forced cleanup.
- Confirm route changes and frontend reloads preserve the PTY while explicit Pau
  shutdown terminates it.
- Run focused tests on Linux and macOS.

#### 2.25 Terminal UI

Status: planned
Blocked by: 2.2, 2.3, 2.10, 2.24

Integrate xterm.js with tabs, main-surface and bottom-dock layouts, fit, search,
copy and paste, activity, exit state, conservative links, and the active ANSI
theme.

Verification:

- Run shell, alternate-screen, mouse, Unicode, selection, search, and resize
  scenarios in Playwright.
- Verify terminal tabs survive route changes and reconnect to their PTYs after a
  frontend reload.

#### 2.26 Workspace shell environments

Status: planned
Blocked by: 2.24, 2.25

Add shell launch profiles for inherited environment, login shell, and explicitly
trusted `direnv exec`. Never source `.envrc` directly.

Verification:

- Cover workspaces with no `.envrc`, allowed and blocked `.envrc` files, failed
  direnv evaluation, and paths containing spaces.
- Confirm the UI reports the active environment mode.

#### 2.27 Worktree creation and attachment

Status: planned
Blocked by: 2.19, 2.21

Create or attach Git worktrees and register them as workspaces. Do not commit,
push, or delete branches automatically.

Verification:

- Cover new branches, existing branches, existing worktrees, dirty source
  repositories, duplicate paths, and cleanup after a failed creation.

### Neovim UI

#### 2.28 Embedded Neovim lifecycle

Status: planned
Blocked by: 2.4, 2.6, 2.9

Start and supervise `nvim --embed` in `pau-term`, attach through the selected
RPC library, and report version and exit state.

Verification:

- Cover missing and unsupported Neovim, startup failure, clean exit, crash, and
  staged shutdown.

#### 2.29 Base Neovim grid

Status: planned
Blocked by: 2.2, 2.9, 2.28

Handle line-grid redraws, highlights, cursor, mode, and resize using the
selected renderer or the thin renderer approved by unit 2.9.

Verification:

- Replay redraw fixtures for ASCII, Unicode, wide glyphs, combining characters,
  scrolling, highlight changes, and cursor movement.
- Compare rendered screenshots at two sizes.

#### 2.30 Neovim input and clipboard

Status: planned
Blocked by: 2.29

Forward keyboard, mouse, focus, paste, and clipboard operations without stealing
application shortcuts outside the editor surface.

Verification:

- Exercise insert, normal, visual, command, mouse, IME, paste, and clipboard
  flows.
- Confirm focus entering and leaving the editor restores the correct application
  shortcuts.

#### 2.31 Neovim multigrid and floating windows

Status: planned
Blocked by: 2.29, 2.30

Enable multigrid, floating windows, external messages, and popup menus after the
base grid is stable.

Verification:

- Replay fixtures for splits, floating windows, completion menus, messages, and
  grid destruction.
- Confirm overlays stay inside the editor viewport.

#### 2.32 Neovim reconnect and theming

Status: planned
Blocked by: 2.10, 2.29, 2.30

Reconnect a reloaded frontend without killing Neovim. Start clean by default and
add separate controls for loading the user's `init.lua` and applying Pau's
current theme. Keep a bundled or fetched Kickstart preset in the backlog.

Verification:

- Reload during editing and confirm buffer, mode, cursor, and process identity
  survive.
- Confirm the default process does not load the user's configuration, then
  exercise the explicit `init.lua` mode.
- Test all five bundled highlight mappings with and without user configuration.
- Confirm Pau does not override Neovim colors until the user opts in.

### Pi resources

#### 2.33 Resource discovery

Status: planned
Blocked by: 2.5, 2.11

Index user and project Pi skills, extensions, prompts, themes, and packages from
Pi's normal locations. Preserve scope, source, and discovery warnings.

Verification:

- Test valid, malformed, duplicate, missing, symlinked, user, and project
  resources against fixture directories.

#### 2.34 Resource browser

Status: planned
Blocked by: 2.3, 2.10, 2.33

Build the Skills, Extensions, Prompts, Themes, and Packages views with source,
scope, trust, validation, filtering, and selected-resource detail.

Verification:

- Component-test empty, loading, invalid, untrusted, and mixed-scope states.
- Verify filtering and keyboard navigation against a large fixture index.

#### 2.35 Skill and prompt editing

Status: planned
Blocked by: 2.14, 2.33, 2.34

Create and edit skills and prompts through file-preserving operations, then ask
Pi to reload resources.

Verification:

- Create a valid resource, reject invalid metadata, preserve supporting files,
  and show reload errors without losing edits.

#### 2.36 Package management

Status: planned
Blocked by: 2.14, 2.33, 2.34

Install, update, filter, enable, disable, and remove Pi packages through Pi's
supported commands or APIs. Show source and scope before mutation.

Verification:

- Exercise npm, Git, and local fixture packages in user and project scope.
- Cover trust denial, command failure, partial installation, and rollback or
  recovery guidance.

#### 2.37 Extension UI requests

Status: planned
Blocked by: 2.12, 2.16

Surface supported Pi RPC extension dialogs and notifications without attempting
to render terminal-only custom components.

Verification:

- Cover confirmation, selection, input, notification, cancellation, timeout, and
  unsupported custom UI requests with a fixture extension.

### Release surfaces

#### 2.38 Website deployment

Status: planned
Blocked by: 2.7, 2.10, 2.18, 2.25, 2.32, 2.37

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

#### 2.39 AppImage packaging

Status: planned
Blocked by: 2.7, 2.18, 2.23, 2.25, 2.32, 2.37

Package the first Linux desktop release as an AppImage. Leave `.deb`, RPM,
Intel macOS, signing, and notarization until release demand or available signing
infrastructure requires them.

Verification:

- Build the AppImage in the release environment.
- Launch it on the supported NixOS development machine and representative Ubuntu
  and Fedora environments.
- Complete the local backend, bundled frontend, terminal, and Neovim startup
  smoke test.

Deliverable exit: the Tauri app can run concurrent Pi and Claude work, inspect
and edit a workspace, use a persistent terminal, and use embedded Neovim. The
same UI works in a browser against the local development backend, all five
themes cover the shipped surfaces, and the website and AppImage are publishable.

## 3. Web server

The third deliverable turns the same local backend and frontend into a
standalone process without creating a second application stack.

### 3.1 Standalone serve command

Status: planned
Blocked by: 2

Add a `pau serve` command that serves the built UI and API without Tauri, binds
to loopback by default, and prints a tokenized URL once.

Verification:

- Start from a packaged binary with no frontend development server.
- Load the UI, connect its WebSocket, and reject a request without the token.

### 3.2 Server process ownership

Status: planned
Blocked by: 3.1

Keep agents, terminals, and Neovim alive across browser disconnects. Add orderly
shutdown and recovery of persisted process metadata after an unclean restart.

Verification:

- Disconnect all browsers while each process type is active and reconnect.
- Send termination signals during active work and confirm bounded cleanup.
- Restart after a forced kill and report which native sessions can be resumed.

### 3.3 Server-mode browser suite

Status: planned
Blocked by: 3.1, 3.2

Run the existing `apps/web` integration and Playwright suites against the
packaged standalone server rather than a test-only transport.

Verification:

- Complete workspace, Pi session, Claude session, file, terminal, Neovim,
  resource, and theme flows against fake adapters in CI.

### 3.4 Non-loopback safety gate

Status: planned
Blocked by: 3.1

Require an explicit flag and durable authentication configuration before binding
to a non-loopback address. Enforce origin checks and secure cookie or
bearer-token handling.

Verification:

- Refuse unsafe non-loopback startup combinations.
- Test allowed and denied origins, expired credentials, logout, and WebSocket
  authentication.

### 3.5 Remote session and audit controls

Status: planned
Blocked by: 3.4

Add session expiry, credential rotation, rate limits for authentication
attempts, and audit events for process and file mutations.

Verification:

- Test idle and absolute expiry, key rotation with existing sessions, rate-limit
  recovery, and redaction of command secrets from audit output.

### 3.6 Reverse-proxy deployment guide

Status: planned
Blocked by: 3.4, 3.5

Document TLS termination, WebSocket forwarding, trusted proxy settings, data
directories, backups, and the server account's command-execution privileges.

Verification:

- Run the documented configuration against one supported reverse proxy and
  complete an authenticated WebSocket session.
- Check every documented command from a clean environment.

### 3.7 Codex adapter

Status: planned
Blocked by: 2

Add Codex discovery, structured transport, native resume, capabilities,
fixtures, and UI exposure through `pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Codex executable.
- Keep live Codex tests opt-in.

### 3.8 Antigravity adapter

Status: planned
Blocked by: 2

Add Antigravity discovery, structured transport, native resume, capabilities,
fixtures, and UI exposure through `pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Antigravity executable.
- Keep live Antigravity tests opt-in.

### 3.9 MCP configuration discovery

Status: planned
Blocked by: 2, 3.7, 3.8

Discover each agent's MCP configuration without treating different formats as
one schema. Preserve unknown fields and identify source and scope.

Verification:

- Round-trip representative Pi, Claude, Codex, and Antigravity fixtures without
  changing unknown fields or formatting unrelated entries.

### 3.10 MCP editing and diagnostics

Status: planned
Blocked by: 3.9

Add create, edit, remove, enable, disable, and test operations through
agent-specific adapters. Report startup stderr and negotiated capabilities.

Verification:

- Exercise stdio and HTTP fixture servers, environment variables, startup
  timeout, protocol failure, stderr output, and clean shutdown.
- Confirm secrets remain redacted in UI events and logs.

### 3.11 CodeMirror language services

Status: planned
Blocked by: 2

Add an optional backend language-server supervisor and a narrow CodeMirror
completion and diagnostics client. Reuse workspace process and environment
handling.

Verification:

- Start one fixture language server, publish diagnostics, request completion,
  restart after failure, and stop it when the workspace closes.
- Confirm Neovim language-server processes remain independent.

Deliverable exit: Pau runs as a local or explicitly secured remote web service
without Tauri, with the same UI and backend behavior as the desktop application.

## Research backlog

Remote machine control is distinct from hosted execution. Research SSH and
Mosh—the mobile shell the earlier note likely referred to—plus authentication,
workspace discovery, process ownership, port forwarding, and reconnect semantics
before assigning it to a deliverable. Do not assume the local Axum API is safe
to expose as a remote-control transport.

A Kickstart-based Neovim profile, `.deb` and RPM packages, Intel macOS, signing
and notarization automation, shared workspaces, agent councils, workflow graphs,
mobile clients, and extension marketplaces remain backlog items.

Cloud sandboxes and hosted execution are not planned.
