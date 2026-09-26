# Roadmap

Work is organized into ordered deliverables. Each numbered unit should fit in
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
surface: after its live smoke test passes, use it for suitable Pau work. Later
units use working Pau surfaces during normal development without replacing
deterministic tests or widening the active unit.

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
status `complete`. Keep completed units in the active deliverable. When the
whole deliverable is complete, record it in `CHANGELOG.md`, remove satisfied
references to it from blocker lists, and remove its roadmap section.

Each unit also lists its direct blockers. A whole number refers to every unit in
that deliverable; for example, `Blocked by: 2` means every unit in deliverable 2
must be `complete`. A dotted identifier refers to one unit.
Transitive blockers are implied and are not repeated. `Blocked by: none` means
there is no dependency. A planned unit is ready when every listed blocker has
status `complete`.

## 2. Desktop app and development web UI

The SvelteKit app runs in a normal browser during development. Tauri is the
shipped application in this deliverable.

### Pi compatibility

#### 2.37 Extension UI requests

Status: complete
Blocked by: none

Surface supported Pi RPC extension dialogs, notifications, status text, and
string widgets without attempting to render terminal-only custom components.
Keep the operator's configured extensions and do not inject a Pau helper
extension.

Verification:

- Cover confirmation, selection, input, editor, notification, status, widget,
  cancellation, timeout, and unsupported custom UI requests with a fixture
  extension.
- Confirm a terminal-only custom component reports the limitation and can be
  used by opening vanilla Pi in a Pau terminal.

### MCP

#### 2.47 MCP configuration discovery

Status: complete
Blocked by: none

Discover Pi and Claude MCP configuration without treating their formats as one
schema. Preserve unknown fields and identify source and scope. Keep existing
native MCP configuration active. Store Pau-managed enablement as a workspace
default with a per-session override. For Pi, recognize the explicitly installed
`pi-mcp-adapter` package and its documented shared, user, project, package, and
Pi-specific sources without silently installing, importing, enabling, or
connecting it. Update prompts to follow indexed project documentation.

Verification:

- Round-trip representative Pi and Claude fixtures without changing unknown
  fields or formatting unrelated entries.
- Exercise `pi-mcp-adapter` precedence, disabled overrides, unknown fields, and
  source provenance against the pinned release and one compatible update.
- Confirm Pau-managed MCP is off before explicit enablement and show an
  actionable unavailable state when Pi MCP is configured but the package is
  absent or disabled.

#### 2.48 MCP editing and diagnostics

Status: complete
Blocked by: 2.37, 2.47

Add create, edit, remove, enable, disable, authenticate, and test operations
through the Pi and Claude adapters. Report startup diagnostics and negotiated
capabilities. Enable servers individually and connect lazily. Pi delegates MCP
execution to the explicitly installed `pi-mcp-adapter` package. Native clients
retain OAuth credentials, and MCP tool calls use the active adapter permission
capability when available.

Verification:

- Run the pinned `pi-mcp-adapter` under Pi RPC and exercise stdio and HTTP
  fixture servers, lazy startup, environment variables, approval, elicitation,
  OAuth, startup timeout, protocol failure, status updates, and clean shutdown.
- Confirm Pi's supported dialogs and notifications work through the extension UI
  protocol and no test depends on parsing a terminal-only MCP panel.
- Exercise the corresponding native configuration, authentication, test, status,
  failure, and shutdown flows for Claude.
- Confirm secrets remain redacted in UI events and logs.

### Workspace tools

#### 2.19 Workspace registry and file access

Status: complete
Blocked by: none

Open and remember workspace roots. Add canonicalized, root-confined file
listing, reading, writing, and search APIs.

Verification:

- Cover symlink escapes, `..` traversal, paths with non-ASCII characters,
  ignored files, hidden files, and files changed between read and write.

#### 2.20 File tree and search UI

Status: complete
Blocked by: 2.19

Add the file tree, file-type icons, ignored/hidden-file controls, and file
search to the workspace layout.

Verification:

- Component-test loading, empty, permission-error, deep-tree, and large-result
  states.
- Verify keyboard navigation and long-path overflow at narrow and wide widths.

#### 2.21 Git status

Status: complete
Blocked by: 2.19, 2.20

Read repository and worktree status without mutating Git. Show branch and
changed-file state using Octicons and text labels.

Verification:

- Cover untracked, modified, staged, deleted, renamed, conflicted,
  detached-HEAD, and non-repository workspaces.

#### 2.22 CodeMirror editor

Status: planned
Blocked by: 2.19, 2.20

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

### Process observability and containment

#### 2.41 Resource monitoring

Status: planned
Blocked by: none

Sample Pau-owned process trees and show aggregate and per-session CPU, current
and peak resident memory, process count, elapsed time, and disk I/O where the
platform reports it reliably. Keep bounded raw history in memory and persist a
small summary when a process ends. Keep token, context, and cost usage separate.

Verification:

- Use a deterministic sampler fixture to cover PID reuse, descendants, process
  exit, missing counters, bounded retention, throttled updates, and summary
  persistence.
- Exercise sustained-pressure warnings and explicit interrupt and stop actions
  without automatically terminating work.
- Run focused process-tree and metric smoke tests on Linux and macOS.

#### 2.42 Local sandbox dependency and policy spike

Status: planned
Blocked by: none

Evaluate maintained Linux and macOS containment mechanisms using the workspace
sandboxes in Claude Code and Codex as reference behavior. Exercise pinned
`@anthropic-ai/sandbox-runtime` 0.0.77 and its Bubblewrap, network namespace, and
seccomp boundary on Linux and Seatbelt boundary on macOS. Prove the separate Pi
tool-host design while the RPC agent and its model credentials remain outside
the sandbox. Do not treat permission hooks, in-process path checks, or
whole-agent wrapping with exposed credentials as a sandbox.

Verification:

- Run fixture processes that attempt allowed and denied file, network, local
  socket, environment, credential, protected-configuration, and subprocess
  operations on Linux and macOS.
- Verify workspace-write and read-only profiles, network-off defaults, explicit
  grants, no silent unsandboxed fallback, and separate opt-in profiles for
  operator terminals and Neovim.
- Exercise the runtime's dependency checks, Ubuntu user-namespace restriction,
  symlink handling, resolved-address guards, descendant inheritance, violation
  attribution, cleanup, and fail-closed startup behavior.
- Prototype all Pi built-in file, search, and command tools through a sandboxed
  worker. Confirm Pi provider traffic and model credentials stay in the RPC
  host, and identify extension and MCP tools that must be disabled.
- Record the selected dependencies, licenses, maintenance state, guarantees,
  known gaps, and the requirement that justifies any custom code in
  `plan/backend.md`.

#### 2.43 Managed process sandbox

Status: planned
Blocked by: 2.42

Add explicit sandboxed and unsandboxed profiles at each proven adapter or tool
execution boundary. Default to unsandboxed launch. Store a workspace default
with a per-session override and show effective access before sandboxed work.
Implement the Pi extension and tool-host protocol for every enabled built-in
file, search, and command tool. Apply the profile to tool descendants and
supported stdio MCP servers. Disable unreviewed in-process and remote tools while
the profile is active. Terminals and Neovim require a separate explicit sandbox
selection.

Verification:

- Cover profile validation, canonicalized roots, read-only and writable mounts,
  network policy, minimal environment construction, resource limits, descendant
  inheritance, worker cancellation and crash, startup failure, and cleanup.
- Run parity tests for read, write, edit, list, find, grep, shell execution,
  streaming output, abort, timeout, and tool-result truncation through the Pi
  worker.
- Confirm supported stdio MCP servers inherit the selected sandbox and that
  remote or unreviewed in-process MCP tools are disabled under that profile.
- Confirm new work launches unsandboxed until the operator selects a sandbox
  profile, the UI names platform guarantees and disabled tools, and permission
  modes are never presented as containment.
- Complete a self-hosted Pi and Claude task inside the supported local sandbox.

#### 2.46 Sandboxed credential brokerage

Status: planned
Blocked by: 2.42, 2.43

Add opt-in credential references for sandboxed tools. Resolve named host
environment variables in the trusted supervisor, pass real values only to the
dedicated broker process, place per-session sentinels in the tool host, and
substitute them through the TLS-terminating egress proxy only for an explicit
destination set. Persist references, never values. Keep model and MCP OAuth
credentials in their native hosts and stores. Deny credential files in the
initial cross-platform profile and reject unsupported protocols, trust
arrangements, or structured-value mismatches instead of exposing raw values.

Verification:

- Cover missing and malformed sources, fail-closed structured extraction,
  per-session sentinel uniqueness, destination scoping, wildcard and port
  handling, TLS verification, DNS and resolved-address checks, header and
  request-body substitution, and teardown.
- Confirm the real value is absent from the worker environment, filesystem,
  arguments, tool output, UI events, violation records, diagnostics, and logs.
- Confirm plaintext HTTP, certificate-pinned and mTLS destinations, SOCKS-only
  protocols, excluded TLS domains, unknown credential shapes, and proxy failure
  deny injection without an unsandboxed retry.
- Exercise common bearer-token and structured environment values on Linux and
  macOS. Test AWS SigV4 only if it remains in the selected dependency's reviewed
  surface; otherwise label it unsupported.
- Demonstrate that a permitted destination may exercise or reflect a brokered
  credential, and show that limitation in the effective-profile UI and user
  documentation.

### Permissions

#### 2.44 Permission policy and Pi enforcement spike

Status: planned
Blocked by: 2.37

Validate the cross-agent permission model against native adapter callbacks and
the selected `@gotgenes/pi-permission-system` release. Map Pau's no-prompts,
confirm-writes-and-commands, and confirm-mutating-or-network profiles without
forking the package. Verify workspace reads, protected sensitive paths,
outside-workspace reads, session-only approvals, and concurrent request
behavior.

Verification:

- Prove allow and deny happen before a fixture tool, shell command, file write,
  sensitive read, network action, and MCP call executes.
- Confirm unsupported adapters cannot present cosmetic permission controls.
- Run the pinned Pi package under RPC and verify its non-TUI `select` and `input`
  fallback, fail-closed behavior, configuration scope, review events, and
  compatibility with the selected Pi versions.
- Recheck and record its source, license, maintenance state, protocol boundary,
  and known gaps in `plan/backend.md`.

#### 2.45 Permission profiles and requests

Status: planned
Blocked by: 2.43, 2.44

Implement the selected permission profiles through adapter-native callbacks and
the reviewed Pi package. Show the requesting session, operation, affected paths
or destination, selected sandbox, and approval lifetime. Keep permission rules
separate from sandbox profiles and redact audit records.

Verification:

- Cover deny, allow once, allow for session, bounded reconnect, timeout,
  cancellation, concurrent per-session queues, stale responses, session
  replacement, and adapter failure.
- Confirm an approval cannot exceed sandbox access and direct terminal input
  does not create agent permission prompts.
- Complete self-hosted Pi, Claude, and MCP fixture flows with permissions off and
  with each shipped permission profile enabled.

#### 2.24 PTY backend

Status: planned
Blocked by: 2.41, 2.43

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
Blocked by: 2.24

Integrate xterm.js with tabs, main-surface and bottom-dock layouts, fit, search,
copy and paste, activity, exit state, conservative links, and the active ANSI
theme.

Verification:

- Run shell, alternate-screen, mouse, Unicode, selection, search, and resize
  scenarios in Playwright.
- Verify terminal tabs survive route changes and reconnect to their PTYs after a
  frontend reload.
- Confirm sandboxed terminal profiles inherit their recorded filesystem,
  network, environment, and process limits.

#### 2.40 Pi TUI parity and primary dogfood gate

Status: planned
Blocked by: 2.23, 2.25, 2.37, 2.45, 2.48

Complete desktop equivalents for vanilla Pi input history, image input, queues,
interrupt and retry controls, models, thinking levels, context and cost,
compaction, session navigation, command discovery, shell context, transcript
search and copy, and export. Use vanilla Pi in the persistent terminal only for
terminal-specific extension components.

Verification:

- Audit the current Pi TUI actions and RPC commands against the implemented Pau
  controls, recording unsupported native capabilities with an explanation.
- Complete normal project work through Pau using configured skills, prompts,
  extensions, MCP tools when installed, queued messages, compaction, session
  branching, review, and the persistent terminal.

**Primary dogfood replacement point:** When 2.40 is complete, Pau replaces
vanilla Pi with `pi-mcp-adapter` in a terminal for routine Pi work, including
MCP. Vanilla Pi remains available in Pau's persistent terminal for terminal-only
extension components. Pau is also the primary dogfood interface for routine
Claude work. Embedded Neovim and release packaging remain later milestones.

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
Blocked by: 2.41, 2.43

Start and supervise `nvim --embed` in `pau-term`, attach through the selected
RPC library, and report version and exit state.

Verification:

- Cover missing and unsupported Neovim, startup failure, clean exit, crash, and
  staged shutdown.

#### 2.29 Base Neovim grid

Status: planned
Blocked by: 2.28

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
Blocked by: 2.29, 2.30

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
Blocked by: none

Index user and project Pi skills, extensions, prompts, themes, and packages from
Pi's normal locations. Preserve scope, source, and discovery warnings.

Verification:

- Test valid, malformed, duplicate, missing, symlinked, user, and project
  resources against fixture directories.

#### 2.34 Resource browser

Status: planned
Blocked by: 2.33

Build the Skills, Extensions, Prompts, Themes, and Packages views with source,
scope, trust, validation, filtering, and selected-resource detail.

Verification:

- Component-test empty, loading, invalid, untrusted, and mixed-scope states.
- Verify filtering and keyboard navigation against a large fixture index.

#### 2.35 Skill and prompt editing

Status: planned
Blocked by: 2.33, 2.34

Create and edit skills and prompts through file-preserving operations, then ask
Pi to reload resources.

Verification:

- Create a valid resource, reject invalid metadata, preserve supporting files,
  and show reload errors without losing edits.

#### 2.36 Package management

Status: planned
Blocked by: 2.33, 2.34

Install, update, filter, enable, disable, and remove Pi packages through Pi's
supported commands or APIs. Show source and scope before mutation.

Verification:

- Exercise npm, Git, and local fixture packages in user and project scope.
- Cover trust denial, command failure, partial installation, and rollback or
  recovery guidance.

### Release surfaces

#### 2.49 Website interface

Status: planned
Blocked by: none

Apply the approved public-site direction from `packages/prototype` to
`apps/website`. Build the landing page, documentation reading shell, generated
navigation and table of contents, Pagefind search UI, capability reference, and
light, dark, and system theme controls. Use fixed interactive examples for
sessions, file selection and diffs, and MCP lifecycle states without connecting
the public site to agent state. Keep available behavior distinct from planned
work, and keep the prototype's view switcher out of the public navigation.

Verification:

- Build the website and validate frontmatter, internal links, heading structure,
  raw Markdown routes, copyable commands, and Pagefind indexing.
- Exercise global and documentation navigation, search, copy controls, theme
  persistence, interactive examples, keyboard access, and reduced motion.
- Review the landing page, documentation shell, and capability reference at
  desktop and narrow widths in light and dark themes.

#### 2.38 Website deployment

Status: planned
Blocked by: 2.25, 2.32, 2.49

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

#### 2.39 AppImage packaging

Status: planned
Blocked by: 2.23, 2.25, 2.32, 2.37, 2.40, 2.41, 2.43, 2.45

Package the first Linux desktop release as an AppImage. Leave `.deb`, RPM,
Intel macOS, signing, and notarization until release demand or available signing
infrastructure requires them.

Verification:

- Build the AppImage in the release environment.
- Launch it on the supported NixOS development machine and representative Ubuntu
  and Fedora environments.
- Complete the local backend, bundled frontend, terminal, and Neovim startup
  smoke test.

Deliverable exit: the Tauri app can run concurrent Pi and Claude work, cover
vanilla Pi's structured interactive workflows, configure and use their MCP
servers, inspect and edit a workspace, use a persistent terminal, and use
embedded Neovim. It reports local resource use and can launch supported work
inside an explicit local sandbox. The same UI works in a browser against the
local development backend, all five themes cover the shipped surfaces, and the
website and AppImage are publishable.

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
fixtures, and UI exposure through `pau-agent`. Map its native MCP configuration
and lifecycle into the MCP adapter capabilities established in units 2.47 and
2.48.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Codex executable.
- Round-trip Codex MCP configuration and exercise one fixture server through the
  shared MCP UI without changing unknown native fields.
- Keep live Codex tests opt-in.

### 3.8 Antigravity adapter

Status: planned
Blocked by: 2

Add Antigravity discovery, structured transport, native resume, capabilities,
fixtures, and UI exposure through `pau-agent`. Map its native MCP configuration
and lifecycle into the MCP adapter capabilities established in units 2.47 and
2.48.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Antigravity executable.
- Round-trip Antigravity MCP configuration and exercise one fixture server
  through the shared MCP UI without changing unknown native fields.
- Keep live Antigravity tests opt-in.

### 3.9 CodeMirror language services

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
