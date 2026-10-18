# Surface briefs

These briefs keep the prototype design file and product direction aligned.
Every page in `pau.fig` maps to one brief below, and each frame on a page is one
state of that surface. Update the brief, the frames, and their HTML pages
together when purpose, hierarchy, responsive behavior, or a durable interaction
changes. [`dev/prototype`](../prototype/README.md) describes the file and the
pages.

## Surface index

| Surface               | Page                    | Frames                                                                                                                                                                                                                                                                                                                   | Primary task                                       |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Prototype hub         | `index`                 | [default](../prototype/index.html)                                                                                                                                                                                                                                                                                       | Choose a design fixture                            |
| Dashboard             | `screens/dashboard`     | [default](../prototype/screens-dashboard-default.html), [activity](../prototype/screens-dashboard-activity.html)                                                                                                                                                                                                         | Find active work or a blocking decision            |
| Session               | `screens/session`       | [default](../prototype/screens-session-default.html), [focused](../prototype/screens-session-focused.html)                                                                                                                                                                                                               | Direct one agent session and inspect its work      |
| Harness control       | `screens/orchestration` | [default](../prototype/screens-orchestration-default.html), [details](../prototype/screens-orchestration-details.html)                                                                                                                                                                                                   | Supervise concurrent native sessions               |
| Scratchpad            | `screens/scratchpad`    | [default](../prototype/screens-scratchpad-default.html)                                                                                                                                                                                                                                                                  | Capture notes and send selected context            |
| Editor and review     | `screens/editor`        | [default](../prototype/screens-editor-default.html)                                                                                                                                                                                                                                                                      | Edit a file and review changes                     |
| Embedded editor study | `screens/neovim`        | [default](../prototype/screens-neovim-default.html)                                                                                                                                                                                                                                                                      | Record a deferred deep-integration direction       |
| Terminal              | `screens/terminal`      | [default](../prototype/screens-terminal-default.html)                                                                                                                                                                                                                                                                    | Use persistent PTY sessions                        |
| Processes             | `screens/processes`     | [default](../prototype/screens-processes-default.html)                                                                                                                                                                                                                                                                   | Inspect workspace and session machine resource use |
| Diagnostics           | `screens/diagnostics`   | [default](../prototype/screens-diagnostics-default.html)                                                                                                                                                                                                                                                                 | Inspect and export redacted support data           |
| Resources             | `screens/resources`     | [default](../prototype/screens-resources-default.html)                                                                                                                                                                                                                                                                   | Inspect scope, trust, and capability               |
| Agent sandbox         | `screens/sandbox`       | [sandboxed](../prototype/screens-sandbox-sandboxed.html), [unsandboxed](../prototype/screens-sandbox-unsandboxed.html)                                                                                                                                                                                                   | Choose containment and review access before launch |
| Settings              | `screens/settings`      | [default](../prototype/screens-settings-default.html)                                                                                                                                                                                                                                                                    | Change product and editor preferences              |
| Website and docs      | `docs`                  | [overview](../prototype/docs-overview.html), [guide](../prototype/docs-guide.html), [reference-dark](../prototype/docs-reference-dark.html)                                                                                                                                                                              | Evaluate Pau, learn a task, or check its status    |
| Launch                | `splash/launch`         | [starting](../prototype/splash-launch-starting.html), [service](../prototype/splash-launch-service.html), [checking](../prototype/splash-launch-checking.html), [attention](../prototype/splash-launch-attention.html), [failed](../prototype/splash-launch-failed.html), [ready](../prototype/splash-launch-ready.html) | Understand current startup work                    |
| Reconnect             | `splash/reconnect`      | [offline](../prototype/splash-reconnect-offline.html), [trying](../prototype/splash-reconnect-trying.html), [restored](../prototype/splash-reconnect-restored.html)                                                                                                                                                      | Recover UI connectivity without implying lost work |

## Prototype hub

The hub is a workbench index, not a product dashboard or marketing page. It
lists every fixture in a stable order and explains that fixtures may explore
unimplemented behavior. Flat bordered cells suit the system better than cards.

At narrow widths, the index becomes one column. The fixture navigation remains
horizontally available without reducing labels to icons.

## Dashboard

The dashboard is a return point for cross-workspace attention. It is not a
launch detour, session manager, or generic metrics overview.

Priority order:

1. Work that needs an operator decision.
2. Running and queued sessions.
3. A direct path into the selected session.
4. Changed files and checks on request.

Use one main list rather than permanent workspace and detail rails. Workspace
and status filters belong in the list toolbar. Changed files and checks open in
a toggleable activity panel from the top app bar. Do not repeat harness health
when session state already reports whether each process is usable.

At narrow widths, keep the attention item and work list. Hide the optional
activity panel and move its content to a dedicated view when implemented.
Preserve status text alongside color.

## Session

The transcript and composer lead. Tool activity is compact and can open detail
without turning the transcript into a log viewer. Sandbox denials appear inline
at the point of failure and name the blocked file or network destination when
Pau can identify it. The session rail and inspector can close independently
from controls in the top app bar. Focus mode removes all surrounding navigation
while preserving the active session and composer.

The terminal dock is the only secondary surface that splits the main column.
The inspector shows a compact machine-resource summary with current and peak
use. The composer distinguishes queueing a follow-up from steering the current
turn and keeps model, thinking, permission, and context choices visible. Configured
Pi extensions may add keyed status text and string widgets around the composer.
Their selection, confirmation, input, and editor requests use a focused dialog.
Notifications do not block the transcript.

Sending clears the composer at once. The prompt shows at the end of the
transcript, or in the queue during a run, marked as sending until the agent
echoes it. A prompt the backend refuses stays marked as not sent, and its text
and images return to the composer.

Each workspace in the session rail has a start control. When a session cannot
start, the task surface names the cause and offers a retry. While the backend
connection is down, the session stays readable but sending, starting, and
stopping are disabled until Pau reconnects. A control the agent does not
support is hidden, and the composer explains when no delivery mode is left.

The session rail starts with an Open workspace control. With no workspace
registered, the task surface asks the operator to open a folder. The desktop
app shows the system folder picker. The browser development build asks for the
folder path instead. A folder that is missing or is a file shows the reason
beside the control. A newly opened workspace without sessions offers to start
one.

The shortcut list opens as a dialog over any view. It groups shortcuts by
area, prints each chord the way the platform's menus do, and names the Pi
binding that took a chord when the operator's Pi bindings collide with Pau's.

Terminal-only custom extension components show an explicit limitation instead
of an empty or broken control. The message directs the operator to vanilla Pi
in a Pau terminal.

At narrow widths, the transcript gets the full task area. Session navigation and
inspection move out of the grid. Composer controls may wrap, but sending and the
delivery mode remain reachable.

## Harness control

This surface supervises separate native sessions. It must not imply an
autonomous agent team. The operator assigns work and decides when output moves
between sessions.

Use a session-manager layout rather than a control-room table:

- A compact rail groups and filters sessions
- The main surface follows one selected run
- Current activity, changes, and checks stay in that run's context
- Low-frequency process metadata and capabilities open from the top app bar
- Recent events stay collapsed until requested

The details panel shows only controls and capabilities reported by the selected
adapter. Unsupported controls remain absent or disabled with a reason.

At narrow widths, the selected run owns the task area. Session navigation and
process details move to separate views.

### Reference patterns

The redesign uses common patterns from current agent products without copying
their visual treatment:

- [VS Code Agents window](https://code.visualstudio.com/docs/agents/run/agents-window)
  separates the session list, active conversation, and optional Files and
  Changes panels. It keeps status and change statistics in the session list.
- [Cursor](https://cursor.com/) presents background agents as a chronological
  task list and gives the selected task one focused detail surface.
- [Conductor](https://www.conductor.build/docs) scopes each task to a workspace,
  branch, terminal, diff, checks, and review path instead of presenting a global
  control matrix.
- [GitHub Copilot agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)
  open a session log and overview from a compact sessions panel. Steering and
  stopping happen in the selected session.
- [OpenAI Codex](https://openai.com/codex/) frames parallel work as separate
  worktree-backed tasks across projects.

The shared lesson is to make the session the unit of attention. Lists answer
“what needs me?”; detail surfaces answer “what is this run doing?”; optional
panels answer “what changed underneath?”

## Scratchpad

Scratchpads hold incomplete workspace notes without exposing them to an agent.
A note can remain private, become a saved prompt, or be sent with explicitly
selected context.

The editor leads. The right rail makes the target session and attached files
visible before send. Sending creates a user message; it does not create an
agent-to-agent handoff.

At narrow widths, editing and sending become separate views so the text area
keeps a useful measure.

## Editor and review

CodeMirror handles built-in editing, quick changes, and file previews. The file
tree supplies workspace context; the review inspector supplies changed files and
hunks. A file or workspace can open in the preferred external editor without
hiding CodeMirror's dirty or external-change state. The file rail provides
content search and explicit controls for hidden and ignored files. Tree rows use
arrow-key navigation and preserve full paths through accessible labels when
visible names must truncate. The code surface remains
wider than either rail.

Diff color combines background, foreground, and markers. Diagnostics, dirty
state, external changes, read-only files, binary files, and oversized files need
explicit states.

At narrow widths, the editor owns the full surface. File navigation and review
open separately. Do not compress code between two narrow rails.

## Embedded editor study

This fixture preserves a possible deep Neovim integration for later research. It
is not part of the first release and must not shape the common editor contract.
The first release uses CodeMirror for built-in editing, opens terminal editors
in persistent terminals, and hands files or workspaces to a preferred external
editor.

If deep embedding becomes a product priority, Neovim owns its grid, mode line,
command line, messages, and popup UI. Pau owns surrounding process state and
must not draw application overlays over the buffer.

## Terminal

The terminal is a persistent PTY surface. Raw terminal output is never presented
as structured agent state. Tabs, search, activity, exit status, reconnect, and
bounded replay belong to Pau; emulation belongs to xterm.js.

The terminal canvas leads and uses the active theme's ANSI palette. On narrow
screens, use a full-surface terminal. Keep tab switching and session state
reachable without shrinking the character grid unnecessarily.

## Processes

The workspace Processes view lists each Pau-owned process tree with current CPU,
resident memory, process count, elapsed time, disk I/O when available, and peak
values. Expanding a row shows its root and descendants. Sustained-pressure
warnings stay with the affected session and offer interrupt and stop actions.
Pau does not interrupt, stop, or throttle work automatically.

At narrow widths, each process becomes a labelled metric block. Actions remain
visible, and the process-tree breakdown opens below the selected row. Completed
processes retain a small final summary instead of raw sample history.

## Diagnostics

Diagnostics is an explicit observation mode for troubleshooting release builds.
The view leads with its enabled state, then shows versions, adapter handshakes,
transport and replay state, queue pressure, process and session correlation, and
recent redacted records. Payload tracing is temporary and separate from routine
collection. Export requires the operator to review the current bundle revision
and destination before Pau writes it.

At narrow widths, version cells wrap and transport rows become labelled metric
blocks. Records stack without truncating the operation or correlation fields.
Fault injection belongs to a separate development-only surface, not this view.

## Resources

The list answers what is installed, its scope, trust, validation, and source.
The inspector answers what the selected resource can do, which agents can use
it, and what file or command an update will change. For MCP servers, it also
shows native connection state, startup diagnostics, and negotiated capabilities.
Create, edit, enable, disable, authenticate, test, and remove actions stay with
the selected server.

Selection must not imply trust. Invalid and untrusted resources remain
inspectable. Disabled and failed servers keep their details and a direct next
action. At narrow widths, the selected resource opens as a detail view with a
clear return to the filtered list.

## Agent sandbox

The sandbox view sets a workspace default for new agent sessions, and the same
view applies a session override. It leads with the mode, which starts
unsandboxed, then the profile and explicit grants. Choosing a sandbox shows the
effective access for the selected agent before anything runs: the enforcing
mechanism and platform, writable and denied paths, protected configuration,
network and socket access, credentials, environment, limits, the tools inside
and outside the sandbox, disabled tools, placeholders, and known gaps. The
profile can hold credential references as a host environment variable name, a
reviewed value shape, and one or more TLS destinations. Whole values, URL
passwords, and credentials after the first colon are supported. Each reference
stays editable and removable, and an empty list has a direct add action. An
unverified platform carries a warning, and a host without a sandbox disables the
choice with the reason.

Permission prompts appear only as a note that they never widen the sandbox.
Terminals and editors are named as unsandboxed so the setting does not read as
covering them. At narrow widths, the access list becomes stacked label and value
pairs, and the save action spans the width.

## Settings

Settings group durable choices by user intent. Scope and consequence appear next
to each setting. Theme, font, agent discovery, preferred editor, and terminal
editor launch behavior remain distinct choices.

Pau themes apply only to Pau surfaces. External and terminal editors retain
their own configuration and colors. At narrow widths, section navigation
collapses before controls lose their labels or descriptions.

## Website and documentation

The public site combines **Persuade** and **Read** modes without importing the
desktop application's dense shell. The `docs` page holds one frame each for
the landing page, a documentation reading view, and the capability reference.
Their shared view switcher belongs to the design study, not proposed public
navigation.

The landing page presents Pau as a local IDE and session orchestrator for
developers using Pi and other coding agents. It explains that position through
real objects: agent sessions, workspaces, files, Git state, and native tools.
Interactive previews use the shape of each task: session switching and steering,
file selection with a diff, and an MCP connection lifecycle. They do not pretend
to connect to a live backend. Feature copy separates available behavior from planned first-release
work.

Documentation uses IBM Plex Sans for body copy, Google Sans for headings, and
Google Sans Code for commands and small technical labels. Both color schemes
use an Eldritch-derived palette: cool blue surfaces, bright green action, purple
focus, and yellow or cyan highlights. The dark scheme uses the application
palette directly; the light scheme keeps the same roles at reading contrast.
Both schemes are available from an explicit theme control.

At narrow widths, the hero, previews, feature status, and reference rows become
single-column compositions. Documentation navigation moves out of the reading
column rather than reducing the article measure.

## Launch

Launch is a short system state, not an introduction. It names the current
operation and disappears as soon as the workspace can render. The product mark
is secondary to useful progress. It lists every step with a mark for done, in
progress, waiting, and failed, because a percentage cannot be measured. A step
that fails without stopping launch reads "Needs attention". A failure that stops
launch says why, what to do next, and offers Copy details.

## Reconnect

Reconnect distinguishes a UI transport problem from agent or process failure.
It states what may still be running, retries directly, and makes diagnostics
available without leading with internal codes. The state must preserve user
work and avoid destructive recovery as the primary action.
