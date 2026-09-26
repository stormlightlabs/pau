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

## 2. Desktop app and development browser UI

`apps/desktop` owns the local SvelteKit product and may run in a normal browser
during development. Tauri is the shipped application in this deliverable.
`apps/web` is reserved for the later standalone and remote server product.

### Application ownership

#### 2.52 Desktop product composition

Status: planned
Blocked by: none

Move the current local product routes, API integration, event stream, and browser
tests from `apps/web` into the SvelteKit frontend owned by `apps/desktop`. Keep
shared feature views in `packages/ui`. Give desktop-native capabilities explicit
interfaces and keep `apps/web` as a separate remote application scaffold rather
than a build input for Tauri.

Verification:

- Run the desktop frontend in its development browser mode against the loopback
  Axum backend.
- Build and launch Tauri from the desktop-owned static assets.
- Cover backend startup, authentication, reconnect, route composition, native
  capability availability, and shutdown without importing routes from
  `apps/web`.
- Confirm `apps/web` cannot expose desktop-only capabilities through shared UI
  fixtures or route imports.

### Process observability and containment

#### 2.41 Resource monitoring

Status: complete
Blocked by: none

Sample Pau-owned process trees and show aggregate and per-session CPU, current
and peak resident memory, process count, elapsed time, and disk I/O where the
platform reports it reliably. Show a compact session summary and a workspace
Processes view. Keep bounded raw history in memory and persist a small summary
when a process ends. Keep token, context, and cost usage separate.

Verification:

- Use a deterministic sampler fixture to cover PID reuse, descendants, process
  exit, missing counters, bounded retention, throttled updates, and summary
  persistence.
- Exercise sustained-pressure warnings and explicit interrupt and stop actions
  without automatically terminating work.
- Run focused process-tree and metric smoke tests on Linux and macOS.

#### 2.50 Diagnostics mode

Status: complete
Blocked by: 2.41

Add release-build diagnostics behind an explicit settings control and CLI flag.
Show versions, adapter capabilities and handshakes, transport and replay state,
process lifecycle, queue pressure, and bounded redacted logs and metadata traces.
Keep payload tracing temporary and off by default. Export a user-reviewed
bundle on request. Put fault injection and other behavior-changing controls in
development builds only.

Verification:

- Cover frontend, backend, adapter, and dependency versions; capability
  handshakes; reconnects; event sequence and replay gaps; process starts and
  exits; slow consumers; queue pressure; and dropped updates.
- Exercise bounded retention, concurrent writers, runtime log levels, temporary
  payload tracing, export failure, and process and session correlation.
- Seed credentials, environment values, prompts, file contents, tool arguments,
  transcript content, outside-workspace paths, and sensitive URLs. Confirm they
  are absent from traces, UI events, logs, and exported bundles.
- Confirm release builds omit fault injection and that diagnostics do not change
  authentication, supervision, retry timing, permissions, sandboxing, or
  process limits.
- Capture and inspect one diagnostic bundle during a self-hosted desktop run
  before the primary dogfood gate.

#### 2.29 Durable process ownership and recovery

Status: planned
Blocked by: 2.24, 2.52

Keep agent sessions and terminals alive across desktop frontend reloads, route
changes, and development-browser disconnects. Add orderly Tauri shutdown and
recover persisted process metadata after an unclean application restart. Report
which native sessions can resume instead of implying that every process can be
reattached.

Verification:

- Reload and disconnect every desktop frontend while agent and terminal
  processes are active, then reconnect.
- Send termination signals during active work and confirm bounded cleanup.
- Restart after a forced kill and report which native sessions can resume.
- Confirm process recovery does not weaken authentication, sandboxing,
  permissions, or resource limits.

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
  operator terminals and supported editor launch paths.
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
the profile is active. Terminals and supported editor launch paths require a
separate explicit sandbox selection.

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
Blocked by: none

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

#### 2.54 Local mutation audit

Status: planned
Blocked by: 2.43, 2.52

Record bounded, redacted audit events for desktop process, file, worktree,
package, permission, sandbox, and editor-launch mutations. Keep audit records
separate from diagnostic logs and never retain command secrets, file contents,
tool arguments, credentials, or environment values.

Verification:

- Cover successful, denied, failed, cancelled, and concurrent mutations with
  workspace, session, actor, operation, and result correlation.
- Confirm seeded sensitive values are absent from storage, API responses, UI
  events, and exports.
- Confirm observation does not change authorization, execution order, retries,
  or process ownership.

#### 2.45 Permission profiles and requests

Status: planned
Blocked by: 2.43, 2.44, 2.54

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
Blocked by: 2.24, 2.29, 2.52

Integrate xterm.js with tabs, main-surface and bottom-dock layouts, fit, search,
copy and paste, activity, exit state, conservative links, and the active ANSI
theme.

Verification:

- Run shell, alternate-screen, mouse, Unicode, selection, search, and resize
  scenarios in Playwright, including representative Vim, Neovim, and Helix
  sessions.
- Verify terminal tabs survive route changes and reconnect to their PTYs after a
  frontend reload.
- Confirm sandboxed terminal profiles inherit their recorded filesystem,
  network, environment, and process limits.

#### 2.40 Pi TUI parity and primary dogfood gate

Status: planned
Blocked by: 2.25, 2.45, 2.50, 2.51

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
  branching, review, CodeMirror, preferred-editor handoff, and the persistent
  terminal.

**Primary dogfood replacement point:** When 2.40 is complete, Pau replaces
vanilla Pi with `pi-mcp-adapter` in a terminal for routine Pi work, including
MCP. Vanilla Pi remains available in Pau's persistent terminal for terminal-only
extension components. Pau is also the primary dogfood interface for routine
Claude work. Deep editor embedding and release packaging remain later
milestones.

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
Blocked by: none

Create or attach Git worktrees and register them as workspaces. Do not commit,
push, or delete branches automatically.

Verification:

- Cover new branches, existing branches, existing worktrees, dirty source
  repositories, duplicate paths, and cleanup after a failed creation.

### Editors

#### 2.28 CodeMirror language services

Status: planned
Blocked by: 2.52

Add an optional backend language-server supervisor and a narrow CodeMirror
completion and diagnostics client. Reuse desktop workspace process and
environment handling.

Verification:

- Start one fixture language server, publish diagnostics, request completion,
  restart after failure, and stop it when the workspace closes.
- Confirm external-editor language-server processes remain independent.
- Confirm the remote web app does not claim a desktop language service unless
  its server advertises the capability.

#### 2.51 External editor launch

Status: planned
Blocked by: 2.25, 2.41

Configure a preferred editor and expose its supported workspace, file, line and
column, and diff launch capabilities through known adapters for Neovim, Vim,
Helix, Visual Studio Code, and Zed. Add an explicit command template for other
editors. Launch terminal editors in a persistent Pau terminal. Keep files
authoritative, detect external changes, and report startup failure or useful
process status without claiming ownership of a detached editor.

Verification:

- Exercise workspace, file, line, column, and diff launch for fixture commands
  that model every known adapter and a custom template.
- Cover missing executables, invalid templates, paths with spaces and non-ASCII
  characters, detached GUI processes, terminal editor exit, and rapid repeated
  launch.
- Confirm the UI shows a custom executable and arguments before saving them and
  does not pass file content, credentials, or unrelated environment values.
- Modify an open file from an external and a terminal editor fixture. Confirm
  CodeMirror reports the external change and preserves unsaved work.
- Complete one self-hosted handoff from CodeMirror to the configured editor and
  back through a detected file change.

### Agent adapters

#### 2.47 Codex adapter

Status: planned
Blocked by: 2.52

Add Codex discovery, structured transport, native resume, capabilities,
fixtures, and desktop exposure through `pau-agent`. Map its native MCP
configuration and lifecycle into the existing MCP adapter capabilities and
shared MCP UI.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Codex executable.
- Round-trip Codex MCP configuration and exercise one fixture server through the
  shared MCP UI without changing unknown native fields.
- Keep live Codex tests opt-in.

#### 2.48 Antigravity adapter

Status: planned
Blocked by: 2.52

Add Antigravity discovery, structured transport, native resume, capabilities,
fixtures, and desktop exposure through `pau-agent`. Map its native MCP
configuration and lifecycle into the existing MCP adapter capabilities and
shared MCP UI.

Verification:

- Run discovery, start, prompt, stream, interrupt, resume, failure, and cleanup
  against a fake Antigravity executable.
- Round-trip Antigravity MCP configuration and exercise one fixture server
  through the shared MCP UI without changing unknown native fields.
- Keep live Antigravity tests opt-in.

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
Blocked by: 2.33, 2.52

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
Blocked by: 2.25, 2.49

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

#### 2.39 AppImage packaging

Status: planned
Blocked by: 2.25, 2.40, 2.41, 2.43, 2.45, 2.51

Package the first Linux desktop release as an AppImage. Leave `.deb`, RPM,
Intel macOS, signing, and notarization until release demand or available signing
infrastructure requires them.

Verification:

- Build the AppImage in the release environment.
- Launch it on the supported NixOS development machine and representative Ubuntu
  and Fedora environments.
- Complete the local backend, bundled frontend, CodeMirror, terminal, and
  preferred-editor launch smoke test.

Deliverable exit: the desktop-owned Tauri app can run concurrent Pi, Claude,
Codex, and Antigravity work at each adapter's supported capability level. It
covers vanilla Pi's structured interactive workflows, configures and uses agent
MCP servers, inspects and edits a workspace in CodeMirror, provides optional
language services, uses a persistent terminal, and hands work to a preferred
external editor. It reports local resource use, records redacted mutation audit
events, recovers supported native work after frontend or application failure,
and can launch supported work inside an explicit local sandbox. The desktop
frontend also works in its browser development mode, all five themes cover the
shipped surfaces, and the website and AppImage are publishable.

## 3. Web server

The third deliverable exposes the shared backend through a separately composed
web application for local or remote browser use. It reuses protocol and feature
packages without importing the desktop route tree or native capability layer.

### 3.1 Standalone serve command

Status: planned
Blocked by: 2

Add a `pau serve` command that serves `apps/web` and the API without Tauri,
binds to loopback by default, and prints a tokenized URL once. Support use on the
server host or through an operator-provided SSH tunnel or private tailnet.

Verification:

- Start from a packaged binary with no frontend development server.
- Load the UI, connect its WebSocket, and reject a request without the token.

### 3.2 Standalone server process lifecycle

Status: planned
Blocked by: 3.1

Apply the desktop process-ownership and recovery contracts to the standalone
server lifecycle. Keep agents and terminals alive when every remote browser
disconnects, and stop or recover them according to explicit server shutdown and
restart behavior.

Verification:

- Disconnect all browsers while each process type is active and reconnect.
- Send server termination signals during active work and confirm bounded cleanup.
- Restart the standalone server after a forced kill and report which native
  sessions can resume.

### 3.3 Server-mode browser suite

Status: planned
Blocked by: 3.1, 3.2

Run the existing `apps/web` integration and Playwright suites against the
packaged standalone server rather than a test-only transport.

Verification:

- Complete workspace, Pi session, Claude session, file, CodeMirror, terminal,
  external editor, resource, and theme flows against fake adapters in CI.

### 3.4 Non-loopback safety gate

Status: planned
Blocked by: 3.1

Require an explicit flag and durable authentication configuration before binding
to a non-loopback address. Enforce origin checks and secure cookie or
bearer-token handling. Keep these checks active on private tailnets and document
the difference between loopback port forwarding and direct tailnet binding.

Verification:

- Refuse unsafe non-loopback startup combinations.
- Test allowed and denied origins, expired credentials, logout, and WebSocket
  authentication.

### 3.5 Remote session and audit controls

Status: planned
Blocked by: 3.4

Add remote session expiry, credential rotation, and rate limits for
authentication attempts. Extend the shared mutation audit with remote identity,
authentication, and session-lifecycle events.

Verification:

- Test idle and absolute expiry, key rotation with existing sessions, rate-limit
  recovery, and redaction of command secrets from audit output.

### 3.6 Remote access and reverse-proxy deployment guide

Status: planned
Blocked by: 3.4, 3.5

Document loopback SSH port forwarding, Tailscale access, TLS termination,
WebSocket forwarding, trusted proxy settings, data directories, backups, and the
server account's command-execution privileges. Explain when Tailscale uses a
direct non-loopback listener and when a local forward preserves loopback
binding. Do not present Mosh as an HTTP tunnel.

Verification:

- Complete authenticated WebSocket sessions through an SSH port forward, a
  private tailnet path, and one supported reverse proxy.
- Confirm authentication and origin checks remain active on every path.
- Check every documented command from a clean environment.

Deliverable exit: Pau runs as a local or explicitly secured remote web service
without Tauri. The web app covers server-backed workflows, reports unavailable
native capabilities honestly, and does not depend on the desktop route tree.

## Verification backlog

Run the resource-monitoring sampler smoke test on macOS when a runner is
available.

## Research backlog

Automatic remote-machine setup remains separate from the web server. Research
SSH and Mosh integration, remote workspace discovery, server installation,
process ownership, port-forward management, and reconnect semantics before Pau
tries to discover or control a host. The documented web server may run on an
operator-configured remote host through the authenticated paths in 3.6; Pau does
not automate that host or treat Mosh as browser transport.

Deep browser embedding for Neovim or another editor, a Kickstart-based Neovim
profile, `.deb` and RPM packages, Intel macOS, signing and notarization
automation, shared workspaces, agent councils, workflow graphs, mobile clients,
and extension marketplaces remain backlog items.

Cloud sandboxes and hosted execution are not planned.
