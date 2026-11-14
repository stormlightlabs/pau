# Surface briefs

These briefs record each product surface's purpose, hierarchy, and responsive
behavior. Update the brief when purpose, hierarchy, responsive behavior, or a
durable interaction changes.

## Surface index

| Surface               | States                                                | Primary task                                       |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Dashboard             | default, activity                                     | Find active work or a blocking decision            |
| Session               | default, focused                                      | Direct one agent session and inspect its work      |
| Harness control       | default, details                                      | Supervise concurrent native sessions               |
| Scratchpad            | default                                               | Capture notes and send selected context            |
| Editor and review     | default                                               | Edit a file and review changes                     |
| Embedded editor study | default                                               | Record a deferred deep-integration direction       |
| Terminal              | default                                               | Use persistent PTY sessions                        |
| Processes             | default                                               | Inspect workspace and session machine resource use |
| Diagnostics           | default                                               | Inspect and export redacted support data           |
| Resources             | default                                               | Inspect scope, trust, and capability               |
| Agent sandbox         | sandboxed, unsandboxed                                | Choose containment and review access before launch |
| Settings              | default                                               | Change product and editor preferences              |
| Website and docs      | overview, guide, reference (dark)                     | Evaluate Pau, learn a task, or check its status    |
| Launch                | starting, service, checking, attention, failed, ready | Understand current startup work                    |
| Reconnect             | offline, trying, restored                             | Recover UI connectivity without implying lost work |

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
Pi extensions may add string widgets around the composer. A status line under
the composer shows what Pi's terminal footer shows and the composer does not:
the working directory, branch, token and cache totals, session cost, and
extension status text.
Their selection, confirmation, input, and editor requests use a focused dialog.
Notifications do not block the transcript.

Sending clears the composer at once. The prompt shows at the end of the
transcript, or in the queue during a run, marked as sending until the agent
echoes it. A prompt the backend refuses stays marked as not sent, and its text
and images return to the composer.

When a session stops or fails, a notice takes the composer's place. It names
the state, shows the failure reason, and offers Start again, which resumes the
saved conversation when Pi kept one. An unsent draft returns to the composer
once the session runs. Compact and Stop stay hidden until then.

On launch, Pau returns to the workspace view that was open last. A session
that is still running opens as it was. A session that ended with the app shows
its name, a Stopped status, and the same notice under the header with Resume.
The session rail lists it as the selected row under its workspace and keeps it
like other stopped sessions until it resumes. Pau never resumes it on its own,
because resuming starts Pi. When the
workspace or saved session no longer exists, launch opens the session list
without an error.

Under its live and stopped sessions, each workspace in the session rail lists
its three newest saved Pi sessions that no row above already shows, with a
Stopped status. Clicking one resumes it, as Resume does in the picker that the
workspace's history button opens. A workspace with neither shows "No sessions
yet". When the saved list cannot load, the rail says so under the workspace
and offers Try again.

Each workspace in the session rail has a start control, which starts Pi. The
workspace menu and a newly opened workspace also start Claude Code. When the
readiness report says Claude Code cannot start, those controls are disabled
and show its reason. The Claude Code notice offers Check again, which reads the
report anew once the operator has fixed the cause. When a session cannot
start, the task surface names the cause and offers a retry with the same
agent. While the backend connection is
down, the session stays readable but sending, starting, and stopping are
disabled until Pau reconnects. A control the agent does not
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

The tree, Git status, and open file follow changes on disk without a refresh
control. A clean file reloads in place and keeps its cursor and scroll
position. An edited file keeps the operator's text and shows a notice under
the header with **Keep mine** and **Reload**.

Diff color combines background, foreground, and markers. Diagnostics, dirty
state, external changes, read-only files, binary files, and oversized files need
explicit states.

At narrow widths, the editor owns the full surface. File navigation and review
open separately. Do not compress code between two narrow rails.

## Embedded editor study

This brief records a possible deep Neovim integration for later research. It is
not part of the first release and must not shape the common editor contract.
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

Find in the terminal opens with ⌘F on macOS and Ctrl+Shift+F elsewhere, since
Ctrl+F belongs to the shell. The find bar floats over the top right of the
output on the raised surface, so opening it never resizes the PTY. It searches
the whole scrollback and shows the current match and the total. Enter and
Shift+Enter step through matches. The bar is not a dismissible overlay: clicks
in the output and window switches keep it open, and only Escape or Close end
the search and return focus to the terminal.

Terminals sit in one of two places. The Terminal view gives them the whole
main surface, with a status rail of open terminals. In Sessions, a dock under
the transcript holds the same terminals, so the operator can watch a build
while reading the agent's work. The dock opens from the top bar toggle or
`` Ctrl+` ``, which also works from inside a docked terminal, and starts at 40% of
the main column. Its top edge resizes it and leaves the transcript at least
160px. On narrow windows an open dock takes the whole main surface instead of
a strip. Each bar has a button that moves the terminals to the other place.
They keep running through the move, and focus lands in the active terminal.
Hiding the dock returns focus to whatever opened it.

A background tab that prints output shows an accent dot, and its rail row
reads "New output", until the operator opens it. An exited tab shows its exit
badge in place of the dot.

Plain-text web addresses and workspace file paths in the output open on
click, as OSC 8 links do. A file path becomes a link only when the workspace
confirms it names a file, and it opens in Files at the line the output gave.
Absolute paths, parent-directory paths, and version-like text stay plain.

## Processes

The workspace Processes view lists each Pau-owned process tree with current CPU,
resident memory, process count, elapsed time, disk I/O when available, and peak
values. Expanding a row shows its root and descendants. Sustained-pressure
warnings stay with the affected session and offer interrupt and stop actions.
Pau does not interrupt, stop, or throttle work automatically.

When the main surface is narrower than the table, each process becomes a
labelled metric block whose metrics wrap to the surface. Actions remain visible,
and the process-tree breakdown opens below the selected row. Completed processes
retain a small final summary instead of raw sample history. When Pau cannot
report resource use, the view says so instead of showing an empty list.

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

The contextual rail holds one view per kind: Skills, Prompts, Extensions,
Themes, and Packages, each with its count. A view leads with a name filter and
scope and trust choices, then one row per resource with its name and
description, scope, source kind, and one state: invalid or not installed in
the danger color, then duplicate, missing trust, or warnings in the warning
color, or Loads. The state is always text, never color alone. Rows hide full
paths, which lose their useful end when cut, and the detail shows them. While
the workspace is not trusted, a notice above the filter says Pi skips its
project resources. Discovery warnings that belong to no resource follow the
list.

The list is a listbox. Arrow keys, Home, and End move the selection, Down
Arrow moves from the filter into the list, and only the selected row is in
the tab order. On a wide window the selection fills the inspector.

Selection must not imply trust. Invalid and untrusted resources remain
inspectable. Disabled and failed servers keep their details and a direct next
action. Below the inspector's docking width, choosing a resource replaces the
list with its detail and a Back button that takes focus. Back or Escape
returns to the filtered list with focus on the same row.

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

Settings opens from the app menu, the product rail, and ⌘, (Ctrl+, on Linux).
The context rail lists the sections: Appearance, Notifications, Keyboard,
Editor, and Shell. Choosing one moves focus to it. A section with nothing to
set yet says so. Each setting saves when it changes. A failed save keeps the
previous choice and shows the reason under the setting. Settings that belong
to one view, such as the agent sandbox, MCP servers, and diagnostics, stay in
that view.

Appearance shows each theme as a card painted in that theme's own colors: a
line of code in its syntax colors and a strip of its terminal palette. The
selected card takes the active accent. Each font choice is set in its own
typeface. Motion sits with them.

Theme cards span the section. Other setting rows stop at 40rem, so on a wide
window each control stays near its name.

Notifications offers three policies. The default notifies when a session out
of view waits for input, asks a question, or fails. The second also notifies
when a turn finishes. Off sends no notifications and leaves the app icon badge
alone. The session rail still marks sessions that need attention.

Keyboard lists Pau's shortcuts in the shortcut dialog's groups. Each one names
its scope, such as All views, Sessions, or Desktop app, and whether it gives
way while a text field has focus. The list is read-only. A Pi binding that
takes a chord is noted as it is in the dialog.

Pau themes apply only to Pau surfaces. External and terminal editors retain
their own configuration and colors. At narrow widths, section navigation
collapses before controls lose their labels or descriptions.

## Website and documentation

The public site combines **Persuade** and **Read** modes without importing the
desktop application's dense shell. The design covers three views: the landing
page, a documentation reading view, and the capability reference. A switcher
between them is a design aid, not proposed public navigation.

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

Light is the default scheme. The site uses these colors:

| Role                    | Light     | Dark      |
| ----------------------- | --------- | --------- |
| Ink, body text          | `#202536` | `#e6e9f2` |
| Muted text              | `#5d667e` | `#9aa3bd` |
| Line, rules and borders | `#dce1eb` | `#293044` |
| Paper, page background  | `#f5f7fc` | `#12151d` |
| Deep paper, bands       | `#e9edf6` | `#171b27` |
| Raised, cards           | `#ffffff` | `#202536` |
| Accent                  | `#087a55` | `#38ef9d` |
| Strong accent           | `#055e43` | `#66f3b7` |
| Focus                   | `#7651c5` | `#a48cf2` |
| Highlight               | `#087c99` | `#f1fc79` |
| Code background         | `#171b27` | `#0e1118` |
| Code line               | `#293044` | `#293044` |
| Code text               | `#e6e9f2` | `#e6e9f2` |
| Code prompt             | `#f1fc79` | `#f1fc79` |

Code blocks are dark in both schemes. Only their background changes; the
dark scheme keeps the light code line, text, and prompt colors.

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
