# 2. Desktop app and development browser UI

`apps/desktop` owns the local SvelteKit product and may run in a normal browser
during development. Tauri is the shipped application in this deliverable.
`apps/web` is reserved for the later standalone and remote server product.

## Process containment

### 2.144 Linux denial preload verification

Status: planned
Blocked by: none

Verify the denial preload library on a Linux host and record its overhead.

Verification:

- Cover denied reads, writes, creates, renames, Unix sockets, and direct TCP
  from dynamically linked programs and their descendants.
- Confirm statically linked programs still fail closed and fall back to policy
  comparison or the sandboxed-failure label.
- Measure the library's overhead on a representative build and test command.

## Permissions

### 2.44 Pi permission package spike

Status: planned
Blocked by: none

Validate Pau's permission model against the selected
`@gotgenes/pi-permission-system` release. Map Pau's no-prompts,
confirm-writes-and-commands, and confirm-mutating-or-network profiles without
forking the package. Verify workspace reads, protected sensitive paths,
outside-workspace reads, session-only approvals, and concurrent request
behavior.

Verification:

- Prove allow and deny happen before a fixture tool, shell command, file write,
  sensitive read, network action, and MCP call executes.
- Run the pinned Pi package under RPC and verify its non-TUI `select` and `input`
  fallback, fail-closed behavior, configuration scope, review events, and
  compatibility with the selected Pi versions.
- Recheck and record its source, license, maintenance state, protocol boundary,
  and known gaps in `dev/plan/backend.md`.

### 2.92 Native permission callback spike

Status: planned
Blocked by: none

Validate the same permission profiles against Claude's native permission
callbacks.

Verification:

- Prove allow and deny happen before a fixture tool, shell command, file write,
  and MCP call executes in Claude.
- Confirm unsupported adapters cannot present cosmetic permission controls.
- Record the callback surface and known gaps in `dev/plan/backend.md`.

### 2.54 Mutation audit log

Status: planned
Blocked by: none

Record bounded, redacted audit events for desktop process, file, and sandbox
mutations. Later mutating features add their own events to this log. Keep audit
records separate from diagnostic logs and never retain command secrets, file
contents, tool arguments, credentials, or environment values.

Verification:

- Cover successful, denied, failed, cancelled, and concurrent mutations with
  workspace, session, actor, operation, and result correlation.
- Confirm seeded sensitive values are absent from storage, API responses, UI
  events, and exports.
- Confirm observation does not change authorization, execution order, retries,
  or process ownership.

### 2.45 Pi permission requests

Status: planned
Blocked by: 2.44, 2.54

Implement the selected permission profiles for Pi through the reviewed package.
Queue requests per session, apply allow-once and deny decisions, and write
redacted audit records. Keep permission rules separate from sandbox profiles.

Verification:

- Cover deny, allow once, and concurrent per-session queues against the Pi
  fixture.
- Confirm an approval cannot exceed sandbox access and direct terminal input
  does not create agent permission prompts.

### 2.62 Permission prompts

Status: planned
Blocked by: 2.45

Show each request's session, operation, affected paths or destination, selected
sandbox, and approval lifetime. Adapters without permission support show no
permission controls.

Verification:

- Component-test pending, allowed, denied, and unsupported-adapter states.
- Approve and deny requests in a self-hosted Pi task.

### 2.93 Permission profile setting

Status: planned
Blocked by: 2.62

Let the operator choose a permission profile.

Verification:

- Component-test each shipped profile and the permissions-off state.
- Complete a self-hosted Pi task with permissions off and with each shipped
  permission profile enabled.

### 2.63 Session approvals

Status: planned
Blocked by: 2.45

Add allow-for-session approvals.

Verification:

- Cover allow for session, session end, and session replacement against the Pi
  fixture.

### 2.64 Session approval view

Status: planned
Blocked by: 2.62, 2.63

Offer allow for session in permission prompts and list the active session
approvals.

Verification:

- Component-test the allow-for-session choice and the approval list.

### 2.82 Permission request recovery

Status: planned
Blocked by: 2.63

Handle reconnects, timeouts, cancellation, stale responses, and adapter failure
for pending permission requests.

Verification:

- Cover bounded reconnect, timeout, cancellation, stale responses, and adapter
  failure against the Pi fixture.

### 2.83 Permission request recovery states

Status: planned
Blocked by: 2.64, 2.82

Show timed-out, cancelled, and stale requests. Restore pending prompts after a
reconnect.

Verification:

- Component-test timed-out, cancelled, and stale requests.
- Reload the frontend with a pending request and confirm the prompt returns.

### 2.65 Claude permission requests

Status: planned
Blocked by: 2.82, 2.92

Route Claude's native permission callbacks into the permission request queue.

Verification:

- Cover deny, allow once, allow for session, and adapter failure for Claude.
- Complete a self-hosted Claude task through the permission prompts with
  permissions off and with each shipped permission profile enabled.

### 2.94 MCP permission requests

Status: planned
Blocked by: 2.65

Route MCP tool calls from Pi and Claude through the permission request queue.

Verification:

- Complete self-hosted MCP fixture flows from Pi and Claude with permissions off
  and with each shipped permission profile enabled.

## Terminal and shell

### 2.24 PTY sessions

Status: planned
Blocked by: none

Implement terminal create, input, output, resize, signal, close, and cleanup in
`pau-term`, and stream terminal input and output through the desktop API.

Verification:

- Cover input and output, rapid resize, process exit, noisy output, and forced
  cleanup.
- Run focused tests on Linux and macOS.

### 2.25 Terminal view

Status: planned
Blocked by: 2.24

Integrate xterm.js with terminal tabs, fit, copy and paste, exit state, and the
active ANSI theme.

Verification:

- Run shell, Unicode, selection, copy and paste, and resize scenarios in
  Playwright.
- Confirm exit state and theme changes in each theme.

### 2.57 Terminal detach and replay

Status: planned
Blocked by: 2.24

Add attach, detach, bounded scrollback, and replay on attach to `pau-term`.

Verification:

- Cover detach and replay and discarded scrollback.
- Run focused tests on Linux and macOS.

### 2.58 Terminal reattach

Status: planned
Blocked by: 2.25, 2.57

Reattach terminal tabs with their replayed scrollback after a route change.

Verification:

- Confirm terminal tabs reattach with their scrollback after a route change.

### 2.95 Terminal output backpressure

Status: planned
Blocked by: 2.57

Apply backpressure when a terminal client reads output more slowly than the
PTY produces it.

Verification:

- Cover a slow consumer during noisy output without unbounded memory growth.

### 2.96 Terminal layouts

Status: planned
Blocked by: 2.25

Add main-surface and bottom-dock terminal layouts.

Verification:

- Cover both layouts at desktop and narrow widths.

### 2.97 Terminal search

Status: planned
Blocked by: 2.25

Add search within terminal output.

Verification:

- Cover matches, no matches, and search across scrollback in Playwright.

### 2.98 Terminal links

Status: planned
Blocked by: 2.25

Detect conservative links in terminal output and open them on request.

Verification:

- Cover URLs, workspace file paths, and text that must not become a link.

### 2.99 Terminal activity

Status: planned
Blocked by: 2.25

Mark terminal tabs that have new output while they are in the background.

Verification:

- Component-test idle, active, and exited tabs.

### 2.100 Full-screen terminal programs

Status: planned
Blocked by: 2.25

Support alternate-screen output and mouse input in the terminal view.

Verification:

- Run alternate-screen and mouse scenarios in Playwright, including
  representative Vim, Neovim, and Helix sessions.

### 2.56 Sandboxed terminal relay

Status: planned
Blocked by: 2.24

Add the sandboxed terminal profile. Start a `pau-term` relay inside the sandbox
that opens its own PTY, runs the shell on it, forwards bytes to the operator's
PTY, and applies resizes from a control channel. Terminal editors use the same
profile.

Verification:

- Confirm the inner PTY works under Bubblewrap's private `/dev` and Seatbelt.
- Cover Ctrl-C, Ctrl-Z, `fg`, `bg`, resize redraw in Neovim, shell exit, relay
  crash, and cleanup of the shell's descendants.
- Confirm keystroke injection from the sandboxed shell reaches only the inner
  PTY.
- Confirm sandboxed terminal profiles inherit their recorded filesystem,
  network, environment, and process limits.
- Measure the memory of each terminal's `srt` process.

### 2.101 Sandboxed terminal selection

Status: planned
Blocked by: 2.25, 2.56

Let the operator open a terminal with a sandbox profile and show which profile
each terminal uses.

Verification:

- Component-test sandboxed, unsandboxed, and unavailable profiles.
- Confirm the profile stays unavailable when the relay cannot start.

### 2.26 Login shell environment

Status: planned
Blocked by: 2.24

Add a login-shell launch profile beside the inherited environment.

Verification:

- Cover inherited and login-shell launches and paths containing spaces.

### 2.102 Direnv shell environment

Status: planned
Blocked by: 2.26

Add a launch profile for explicitly trusted `direnv exec`. Never source `.envrc`
directly.

Verification:

- Cover workspaces with no `.envrc`, allowed and blocked `.envrc` files, and
  failed direnv evaluation.

### 2.103 Shell environment selector

Status: planned
Blocked by: 2.25, 2.102

Let the operator choose a workspace's shell environment and report the active
mode in each terminal.

Verification:

- Component-test each environment mode and a failed direnv evaluation.

### 2.27 Worktree attachment

Status: planned
Blocked by: 2.54

Attach existing Git worktrees and register them as workspaces. Record each
attachment in the mutation audit.

Verification:

- Cover existing worktrees, duplicate paths, and dirty source repositories.

### 2.104 Worktree attachment view

Status: planned
Blocked by: 2.27

Let the operator attach an existing worktree as a workspace.

Verification:

- Component-test the attach flow, a duplicate path, and a failed attachment.

### 2.105 Worktree creation

Status: planned
Blocked by: 2.27

Create Git worktrees on new or existing branches and register them as
workspaces. Do not commit, push, or delete branches automatically. Record each
creation in the mutation audit.

Verification:

- Cover new branches, existing branches, dirty source repositories, and cleanup
  after a failed creation.

### 2.106 Worktree creation view

Status: planned
Blocked by: 2.104, 2.105

Let the operator create a worktree on a new or existing branch.

Verification:

- Component-test new-branch, existing-branch, and failed-creation states.

## Process recovery

### 2.29 Process survival

Status: planned
Blocked by: 2.57

Keep agent sessions and terminals alive across desktop frontend reloads, route
changes, and development-browser disconnects.

Verification:

- Disconnect every desktop API client while agent and terminal processes are
  active, then reconnect through the API.
- Confirm process survival does not weaken authentication, sandboxing,
  permissions, or resource limits.

### 2.59 Reconnect states

Status: planned
Blocked by: 2.29, 2.58

Restore agent sessions and terminal tabs in every desktop frontend after a
reload or disconnect. Show reconnecting, restored, and lost states.

Verification:

- Reload the desktop frontend and disconnect the development browser while
  agent and terminal processes are active. Confirm each surface restores its
  state.
- Component-test reconnecting, restored, and lost states.

### 2.107 Orderly shutdown

Status: planned
Blocked by: 2.29

Stop agent sessions and terminals in order when Tauri exits or receives a
termination signal.

Verification:

- Send termination signals during active work and confirm bounded cleanup.

### 2.60 Restart recovery

Status: planned
Blocked by: 2.29

Recover persisted process metadata after an unclean application restart. Report
which native sessions can resume instead of implying that every process can be
reattached.

Verification:

- Restart after a forced kill and report through the API which native sessions
  can resume.
- Confirm recovery does not weaken authentication, sandboxing, permissions, or
  resource limits.

### 2.61 Restart recovery view

Status: planned
Blocked by: 2.59, 2.60

After an unclean restart, show which sessions resumed, which can resume, and
which ended. Let the operator resume each session that supports it.

Verification:

- Component-test resumed, resumable, and ended sessions.
- Force-quit the desktop app during active work, restart it, and resume a
  supported session from the view.

## Editors

### 2.28 Language-server supervisor

Status: planned
Blocked by: none

Add an optional backend language-server supervisor. Reuse desktop workspace
process and environment handling.

Verification:

- Start one fixture language server, restart it after failure, and stop it when
  the workspace closes.
- Confirm external-editor language-server processes remain independent.
- Confirm the remote web app does not claim a desktop language service unless
  its server advertises the capability.

### 2.108 CodeMirror diagnostics

Status: planned
Blocked by: 2.28

Show language-server diagnostics in CodeMirror.

Verification:

- Publish diagnostics from the fixture server and confirm CodeMirror shows and
  clears them.

### 2.109 CodeMirror completion

Status: planned
Blocked by: 2.28

Request completions from the language server in CodeMirror.

Verification:

- Request completion from the fixture server and cover empty and failed
  responses.

### 2.51 Known editor launch

Status: planned
Blocked by: 2.54

Expose workspace, file, line and column, and diff launch capabilities through
known adapters for Neovim, Vim, Helix, Visual Studio Code, and Zed. Report
startup failure or useful process status without claiming ownership of a
detached editor. Record each launch in the mutation audit.

Verification:

- Exercise workspace, file, line, column, and diff launch for fixture commands
  that model every known adapter.
- Cover missing executables, paths with spaces and non-ASCII characters,
  detached GUI processes, and rapid repeated launch.
- Confirm a launch does not pass file content, credentials, or unrelated
  environment values.

### 2.66 Preferred editor setting

Status: planned
Blocked by: 2.51

Let the operator choose a preferred editor from the known adapters.

Verification:

- Component-test each known editor and a missing executable.

### 2.110 Open in editor

Status: planned
Blocked by: 2.66

Add open-in-editor actions for the workspace, the file tree, the CodeMirror
cursor position, and diffs. Show startup failures.

Verification:

- Modify an open file from an external editor fixture. Confirm CodeMirror
  reports the external change and preserves unsaved work.
- Complete one self-hosted handoff from CodeMirror to the configured editor and
  back through a detected file change.

### 2.111 Custom editor command

Status: planned
Blocked by: 2.51

Add an explicit command template for editors without a known adapter.

Verification:

- Exercise every launch capability through a custom template fixture.
- Cover invalid templates and paths with spaces and non-ASCII characters.

### 2.112 Custom editor setting

Status: planned
Blocked by: 2.66, 2.111

Let the operator enter a custom editor command.

Verification:

- Confirm the settings show a custom executable and arguments before saving
  them.

### 2.67 Terminal editor handoff

Status: planned
Blocked by: 2.51, 2.58

Launch terminal editors in a persistent Pau terminal tab and report editor exit.
Files stay authoritative.

Verification:

- Launch each known terminal editor fixture in a terminal tab and cover editor
  exit.
- Modify an open file from a terminal editor fixture. Confirm CodeMirror
  reports the external change and preserves unsaved work.

## Pi desktop parity

### 2.145 Live Pi session API

Status: in progress
Blocked by: none

Start, list, control, and stop Pi sessions through the desktop API, and stream
their events to clients.

Verification:

- Start a session, then prompt, steer, follow up, interrupt, select a model and
  thinking level, read and clear queued messages, list commands, and stop it
  over HTTP and the event stream against the fake Pi executable.
- Cover a missing Pi executable and a session that exits during a request.

### 2.146 Live session view

Status: planned
Blocked by: 2.145

Replace the desktop session route's fixtures with live Pi sessions.

Verification:

- Component-test loading, failed start, and disconnected states.
- Prompt a self-hosted Pi session from the desktop app.

### 2.68 Pi input history API

Status: planned
Blocked by: 2.145

Expose Pi input history through the desktop API.

Verification:

- Cover history recall against the Pi fixture.

### 2.69 Composer input history

Status: planned
Blocked by: 2.68, 2.146

Add input history to the session composer.

Verification:

- Component-test history navigation and an empty history.

### 2.113 Pi image attachment API

Status: planned
Blocked by: 2.145

Accept image attachments with Pi prompts through the desktop API.

Verification:

- Cover prompts with images and unsupported image types against the Pi fixture.

### 2.114 Composer image input

Status: planned
Blocked by: 2.113, 2.146

Add image input to the session composer.

Verification:

- Component-test adding, removing, and rejecting images.
- Send a prompt with an image in a self-hosted Pi session.

### 2.75 Composer command completion

Status: planned
Blocked by: 2.146

Add command completion to the session composer.

Verification:

- Component-test command completion and unsupported commands.
- Run a discovered command in a self-hosted Pi session.

### 2.115 Pi shell context API

Status: planned
Blocked by: 2.145

Expose Pi shell context through the desktop API.

Verification:

- Cover shell context against the Pi fixture.

### 2.116 Composer shell context

Status: planned
Blocked by: 2.115, 2.146

Add shell context to the session composer.

Verification:

- Component-test shell context and its unsupported state.

### 2.71 Message queue view

Status: planned
Blocked by: 2.146

Show queued messages in the session view.

Verification:

- Component-test empty and queued states.
- Queue a message in a self-hosted Pi session.

### 2.117 Pi retry API

Status: planned
Blocked by: 2.145

Expose retry after failure through the desktop API.

Verification:

- Cover retry after failure against the Pi fixture.

### 2.118 Retry control

Status: planned
Blocked by: 2.117, 2.146

Add a retry control to failed turns in the session view.

Verification:

- Component-test failed and retrying states.

### 2.77 Thinking level control

Status: planned
Blocked by: 2.146

Add a thinking-level control to the session view.

Verification:

- Component-test each thinking level and a model without thinking levels.

### 2.119 Pi context usage API

Status: planned
Blocked by: 2.145

Expose context and cost updates through the desktop API.

Verification:

- Cover context and cost updates against the Pi fixture.

### 2.120 Context usage view

Status: planned
Blocked by: 2.119, 2.146

Show context use and cost in the session view.

Verification:

- Component-test normal and near-context-limit states.

### 2.78 Pi compaction API

Status: planned
Blocked by: none

Expose manual and automatic compaction through the desktop API.

Verification:

- Cover manual compaction, automatic compaction, and compaction failure against
  the Pi fixture.

### 2.79 Compaction controls

Status: planned
Blocked by: 2.78, 2.146

Add a compaction control and compaction states to the session view.

Verification:

- Component-test compacting, compacted, and failed states.
- Compact a self-hosted Pi session.

### 2.72 Pi session tree API

Status: planned
Blocked by: 2.145

Expose Pi session trees and branch creation through the desktop API.

Verification:

- Cover tree navigation and branch creation against fixture Pi session files.

### 2.73 Session tree view

Status: planned
Blocked by: 2.72, 2.146

Add session tree navigation and branching to the session view.

Verification:

- Component-test a large branched session.
- Branch a self-hosted Pi session.

### 2.80 Pi transcript search API

Status: planned
Blocked by: 2.145

Expose transcript search through the desktop API.

Verification:

- Cover search against fixture Pi session files.

### 2.81 Transcript search

Status: planned
Blocked by: 2.80, 2.146

Add transcript search to the session view.

Verification:

- Component-test search results and no results.

### 2.121 Pi transcript export API

Status: planned
Blocked by: 2.145

Expose transcript export through the desktop API.

Verification:

- Cover export and export failure against fixture Pi session files.

### 2.122 Transcript copy and export

Status: planned
Blocked by: 2.121, 2.146

Add transcript copy and export to the session view.

Verification:

- Component-test copying and export failure.
- Export a self-hosted Pi session.

### 2.40 Pi TUI parity and primary dogfood gate

Status: planned
Blocked by: 2.61, 2.67, 2.69, 2.71, 2.73, 2.75, 2.77, 2.79, 2.81, 2.83, 2.93,
2.94, 2.95, 2.96, 2.97, 2.98, 2.99, 2.100, 2.107, 2.110, 2.112, 2.114, 2.116, 2.118,
2.120, 2.122

Confirm that the desktop app covers vanilla Pi's interactive workflows, then do
normal project work through Pau. Use vanilla Pi in the persistent terminal only
for terminal-specific extension components.

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

## Agent adapters

### 2.47 Codex sessions

Status: planned
Blocked by: none

Add Codex discovery, structured transport, and capabilities through
`pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, failure, and cleanup against
  a fake Codex executable.
- Keep live Codex tests opt-in.

### 2.123 Codex in the desktop

Status: planned
Blocked by: 2.47

Let the operator start Codex sessions from the desktop app, with controls gated
by Codex's reported capabilities.

Verification:

- Component-test Codex capability states and a missing executable.
- Start and interrupt a session against the fake Codex executable.

### 2.124 Codex resume

Status: planned
Blocked by: 2.47

Resume native Codex sessions through `pau-agent`.

Verification:

- Resume a session against the fake Codex executable and cover a missing
  session.

### 2.125 Codex MCP configuration

Status: planned
Blocked by: 2.47

Map Codex's native MCP configuration and lifecycle into the existing MCP
adapter capabilities and shared MCP UI.

Verification:

- Round-trip Codex MCP configuration and exercise one fixture server through the
  shared MCP UI without changing unknown native fields.

### 2.48 Antigravity sessions

Status: planned
Blocked by: none

Add Antigravity discovery, structured transport, and capabilities through
`pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, failure, and cleanup against
  a fake Antigravity executable.
- Keep live Antigravity tests opt-in.

### 2.126 Antigravity in the desktop

Status: planned
Blocked by: 2.48

Let the operator start Antigravity sessions from the desktop app, with controls
gated by Antigravity's reported capabilities.

Verification:

- Component-test Antigravity capability states and a missing executable.
- Start and interrupt a session against the fake Antigravity executable.

### 2.127 Antigravity resume

Status: planned
Blocked by: 2.48

Resume native Antigravity sessions through `pau-agent`.

Verification:

- Resume a session against the fake Antigravity executable and cover a missing
  session.

### 2.128 Antigravity MCP configuration

Status: planned
Blocked by: 2.48

Map Antigravity's native MCP configuration and lifecycle into the existing MCP
adapter capabilities and shared MCP UI.

Verification:

- Round-trip Antigravity MCP configuration and exercise one fixture server
  through the shared MCP UI without changing unknown native fields.

## Pi resources

### 2.33 Resource discovery

Status: planned
Blocked by: none

Index user and project Pi skills, extensions, prompts, themes, and packages from
Pi's normal locations. Preserve scope, source, and discovery warnings.

Verification:

- Test valid, malformed, duplicate, missing, symlinked, user, and project
  resources against fixture directories.

### 2.34 Resource browser

Status: planned
Blocked by: 2.33

Build the Skills, Extensions, Prompts, Themes, and Packages views with source,
scope, trust, validation, and selected-resource detail.

Verification:

- Component-test empty, loading, invalid, untrusted, and mixed-scope states.

### 2.129 Resource filtering

Status: planned
Blocked by: 2.34

Filter the resource views by name, scope, and trust.

Verification:

- Verify filtering and keyboard navigation against a large fixture index.

### 2.35 Resource file editing API

Status: planned
Blocked by: 2.33

Create and edit skill and prompt files through file-preserving operations, then
ask Pi to reload resources.

Verification:

- Create a valid resource, reject invalid metadata, preserve supporting files,
  and report reload errors.

### 2.130 Skill editor

Status: planned
Blocked by: 2.34, 2.35

Create and edit skills from the resource browser.

Verification:

- Component-test valid, invalid, and reload-failed states without losing edits.

### 2.131 Prompt editor

Status: planned
Blocked by: 2.130

Create and edit prompt templates from the resource browser.

Verification:

- Component-test valid, invalid, and reload-failed states without losing edits.

### 2.36 Package installation

Status: planned
Blocked by: 2.33, 2.54

Install Pi packages through Pi's supported commands or APIs. Record each
installation in the mutation audit.

Verification:

- Exercise npm, Git, and local fixture packages in user and project scope.
- Cover trust denial, command failure, and partial installation with recovery
  guidance.

### 2.132 Package installation view

Status: planned
Blocked by: 2.34, 2.36

Let the operator install a package after showing its source and scope.

Verification:

- Component-test the confirmation, trust denial, and failure states.

### 2.133 Package updates

Status: planned
Blocked by: 2.36

Update installed Pi packages through Pi's supported commands or APIs. Record
each update in the mutation audit.

Verification:

- Cover npm, Git, and local fixture updates and a failed update with recovery
  guidance.

### 2.134 Package update view

Status: planned
Blocked by: 2.132, 2.133

Show available updates and let the operator apply one after showing its source
and scope.

Verification:

- Component-test up-to-date, update-available, and failed states.

### 2.135 Package removal

Status: planned
Blocked by: 2.36

Remove Pi packages through Pi's supported commands or APIs. Record each removal
in the mutation audit.

Verification:

- Cover removal in user and project scope and a failed removal with recovery
  guidance.

### 2.136 Package removal view

Status: planned
Blocked by: 2.132, 2.135

Let the operator remove a package after showing its source and scope.

Verification:

- Component-test the confirmation and failure states.

### 2.137 Package enablement

Status: planned
Blocked by: 2.36

Enable, disable, and filter a package's resources through Pi's supported
commands or APIs. Record each change in the mutation audit.

Verification:

- Cover enabling, disabling, and filtering in user and project scope.

### 2.138 Package enablement view

Status: planned
Blocked by: 2.132, 2.137

Let the operator enable, disable, and filter a package's resources.

Verification:

- Component-test enabled, disabled, and filtered packages.

## Release surfaces

Website units apply the approved public-site direction from
`packages/prototype` to `apps/website`. Keep available behavior distinct from
planned work, and keep the prototype's view switcher out of the public
navigation. Review each website unit at desktop and narrow widths in light and
dark themes.

### 2.49 Website landing page

Status: planned
Blocked by: none

Build the landing page.

Verification:

- Build the website and review the landing page.

### 2.139 Documentation shell

Status: planned
Blocked by: none

Build the documentation reading shell with generated navigation and table of
contents.

Verification:

- Validate frontmatter, internal links, heading structure, raw Markdown routes,
  and copyable commands.
- Exercise global and documentation navigation, copy controls, and keyboard
  access.

### 2.140 Documentation search

Status: planned
Blocked by: 2.139

Add the Pagefind search UI.

Verification:

- Validate Pagefind indexing and exercise search with the keyboard.

### 2.141 Capability reference

Status: planned
Blocked by: 2.139

Build the capability reference.

Verification:

- Confirm available and planned capabilities are labelled distinctly.

### 2.142 Website theme controls

Status: planned
Blocked by: none

Add light, dark, and system theme controls.

Verification:

- Exercise theme persistence and the system theme.

### 2.143 Website interactive examples

Status: planned
Blocked by: 2.49

Add fixed interactive examples for sessions, file selection and diffs, and MCP
lifecycle states without connecting the public site to agent state.

Verification:

- Exercise each example with the keyboard and with reduced motion.

### 2.38 Website deployment

Status: planned
Blocked by: 2.25, 2.140, 2.141, 2.142, 2.143

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

### 2.39 AppImage packaging

Status: planned
Blocked by: 2.25, 2.40, 2.45, 2.51

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
