# Surface briefs

These briefs keep the static prototype and product direction aligned. Every
prototype route maps to one brief below. Update the brief and fixture together
when purpose, hierarchy, responsive behavior, or a durable interaction changes.

## Surface index

| Surface           | Prototype route          | Source                                          | Primary task                                       |
| ----------------- | ------------------------ | ----------------------------------------------- | -------------------------------------------------- |
| Prototype hub     | `/`                      | `src/routes/+page.svelte`                       | Choose a design fixture                            |
| Dashboard         | `/screens/dashboard`     | `src/routes/screens/dashboard/+page.svelte`     | Find active work or a blocking decision            |
| Session           | `/screens/session`       | `src/routes/screens/session/+page.svelte`       | Direct one agent session and inspect its work      |
| Harness control   | `/screens/orchestration` | `src/routes/screens/orchestration/+page.svelte` | Supervise concurrent native sessions               |
| Scratchpad        | `/screens/scratchpad`    | `src/routes/screens/scratchpad/+page.svelte`    | Capture notes and send selected context            |
| Editor and review | `/screens/editor`        | `src/routes/screens/editor/+page.svelte`        | Edit a file and review changes                     |
| Neovim            | `/screens/neovim`        | `src/routes/screens/neovim/+page.svelte`        | Work in an embedded Neovim UI                      |
| Terminal          | `/screens/terminal`      | `src/routes/screens/terminal/+page.svelte`      | Use persistent PTY sessions                        |
| Resources         | `/screens/resources`     | `src/routes/screens/resources/+page.svelte`     | Inspect scope, trust, and capability               |
| Settings          | `/screens/settings`      | `src/routes/screens/settings/+page.svelte`      | Change product and editor preferences              |
| Launch            | `/splash/launch`         | `src/routes/splash/launch/+page.svelte`         | Understand current startup work                    |
| Reconnect         | `/splash/reconnect`      | `src/routes/splash/reconnect/+page.svelte`      | Recover UI connectivity without implying lost work |

Source paths in this table are relative to `packages/prototype`.

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
a toggleable activity panel. Do not repeat harness health when session state
already reports whether each process is usable.

At narrow widths, keep the attention item and work list. Hide the optional
activity panel and move its content to a dedicated view when implemented.
Preserve status text alongside color.

## Session

The transcript and composer lead. Tool activity is compact and can open detail
without turning the transcript into a log viewer. The session rail and inspector
can close independently. Focus mode removes all surrounding navigation while
preserving the active session and composer.

The terminal dock is the only secondary surface that splits the main column.
The composer distinguishes queueing a follow-up from steering the current turn
and keeps model, thinking, permission, and context choices visible.

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
- Low-frequency process metadata and capabilities open in a details panel
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

CodeMirror handles quick edits and file previews. The file tree supplies
workspace context; the review inspector supplies changed files and hunks. The
code surface remains wider than either rail.

Diff color combines background, foreground, and markers. Diagnostics, dirty
state, external changes, read-only files, binary files, and oversized files need
explicit states.

At narrow widths, the editor owns the full surface. File navigation and review
open separately. Do not compress code between two narrow rails.

## Neovim

Neovim owns its grid, mode line, command line, messages, and popup UI. Pau owns
surrounding tabs, rails, process state, and explicit choices to load `init.lua`
or apply a Pau theme.

Pau must not draw application overlays over the Neovim buffer. Reconnect keeps
the process, buffer, mode, and cursor. At narrow widths, the grid gets the full
surface and peripheral information moves away.

## Terminal

The terminal is a persistent PTY surface. Raw terminal output is never presented
as structured agent state. Tabs, search, activity, exit status, reconnect, and
bounded replay belong to Pau; emulation belongs to xterm.js.

The terminal canvas leads and uses the active theme's ANSI palette. On narrow
screens, use a full-surface terminal. Keep tab switching and session state
reachable without shrinking the character grid unnecessarily.

## Resources

The list answers what is installed, its scope, trust, validation, and source.
The inspector answers what the selected resource can do, which agents can use
it, and what file or command an update will change.

Selection must not imply trust. Invalid and untrusted resources remain
inspectable. At narrow widths, the selected resource opens as a detail view with
a clear return to the filtered list.

## Settings

Settings group durable choices by user intent. Scope and consequence appear next
to each setting. Theme, font, agent discovery, Neovim configuration, and Neovim
color application remain distinct choices.

Loading the user's `init.lua` can execute configuration. Applying a Pau theme
changes highlights only after opt-in. At narrow widths, section navigation
collapses before controls lose their labels or descriptions.

## Launch

Launch is a short system state, not an introduction. It names the current
operation and disappears as soon as the workspace can render. The product mark
is secondary to useful progress. Avoid fake percentages when progress cannot be
measured.

## Reconnect

Reconnect distinguishes a UI transport problem from agent or process failure.
It states what may still be running, retries directly, and makes diagnostics
available without leading with internal codes. The state must preserve user
work and avoid destructive recovery as the primary action.
