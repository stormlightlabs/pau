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

### 2.163 Subagent permission setting

Status: planned
Blocked by: none

Let the operator choose whether a session that loads `pi-subagents` refuses a
confirming profile or passes the permission extension and policy to child Pi
processes.

Verification:

- Cover the refusal, its explanation, and a child process that receives the
  extension and policy file.

### 2.45 Pi permission requests

Status: planned
Blocked by: 2.54

Implement the selected permission profiles for Pi through Pau's permission
extension.
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

Let the operator choose a permission profile. Changing it restarts Pi on the
same session file.

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

### 2.57 Terminal detach and replay

Status: planned
Blocked by: none

Add attach, detach, bounded scrollback, and replay on attach to `pau-term`.

Verification:

- Cover detach and replay and discarded scrollback.
- Run focused tests on Linux and macOS.

### 2.58 Terminal reattach

Status: planned
Blocked by: 2.57

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
Blocked by: none

Add main-surface and bottom-dock terminal layouts.

Verification:

- Cover both layouts at desktop and narrow widths.

### 2.97 Terminal search

Status: planned
Blocked by: none

Add search within terminal output.

Verification:

- Cover matches, no matches, and search across scrollback in Playwright.

### 2.98 Terminal links

Status: planned
Blocked by: none

Detect conservative links in terminal output and open them on request.

Verification:

- Cover URLs, workspace file paths, and text that must not become a link.

### 2.99 Terminal activity

Status: planned
Blocked by: none

Mark terminal tabs that have new output while they are in the background.

Verification:

- Component-test idle, active, and exited tabs.

### 2.100 Full-screen terminal programs

Status: planned
Blocked by: none

Support alternate-screen output and mouse input in the terminal view.

Verification:

- Run alternate-screen and mouse scenarios in Playwright, including
  representative Vim, Neovim, and Helix sessions.

### 2.56 Sandboxed terminal relay

Status: planned
Blocked by: none

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
Blocked by: 2.56

Let the operator open a terminal with a sandbox profile and show which profile
each terminal uses.

Verification:

- Component-test sandboxed, unsandboxed, and unavailable profiles.
- Confirm the profile stays unavailable when the relay cannot start.

### 2.26 Login shell environment

Status: planned
Blocked by: none

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
Blocked by: 2.102

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

## Shell and navigation

### 2.171 Application keyboard map

Status: planned
Blocked by: none

Add global shortcuts for navigation, session switching, panel toggles, and page
zoom with ⌘+, ⌘−, and ⌘0, an app menu with New Session (⌘N) and Open Workspace
(⌘O), and a shortcut list that opens with ⌘/. When an app shortcut collides
with one of the operator's Pi bindings, the Pi binding wins.

Verification:

- Component-test each global shortcut, zoom, a shortcut that yields to a
  conflicting Pi binding, and that shortcuts do not fire while a dialog or the
  terminal has focus.
- Open a workspace and start a session from the app menu in the installed app.
- Drive a self-hosted session from launch to a finished turn without the mouse.

### 2.172 Command palette

Status: planned
Blocked by: 2.171

Make the command bar open a palette that searches workspaces, sessions, views,
and session actions and shows each action's shortcut. The palette opens and
closes instantly from the keyboard, filters in the same frame as typing, and
keeps a fixed row height. Pointer opening may fade in over 100ms.

Verification:

- Component-test fuzzy matching, disabled actions with their reasons, an empty
  result, and closing on Escape and on selection.
- Storybook interaction test for opening, filtering, and running an action from
  the keyboard.

### 2.175 Context menus

Status: planned
Blocked by: none

Open a context menu on sessions, workspaces, files, and transcript messages that
lists the actions already available for that item.

Verification:

- Component-test each item's menu, opening it from the keyboard, and a disabled
  action with its reason.

### 2.176 Restore last view on launch

Status: planned
Blocked by: none

Reopen the last workspace and session route on launch, showing a stopped
session from history with a **Resume** action instead of resuming it.

Verification:

- Component-test a live session, a stopped session, and a removed workspace.

### 2.177 Window size and position persistence

Status: planned
Blocked by: none

Restore the main window's size, position, and maximized state on launch, and
center the window at its default size when the saved position is off every
connected display.

Verification:

- Cover saving and restoring the window state and an off-screen position in the
  Tauri shell tests.
- Relaunch the installed macOS build and confirm the window returns to its
  place.

### 2.178 Workspace removal

Status: planned
Blocked by: 2.54

Forget a workspace registration without touching its files, and refuse while it
has live sessions or terminals. Record each removal in the mutation audit.

Verification:

- Cover removal, refusal with a live session, refusal with a live terminal, and
  an unknown workspace.

### 2.179 Workspace removal view

Status: planned
Blocked by: 2.178

Let the operator remove a workspace from the rail after a confirmation that
states the files stay on disk.

Verification:

- Component-test confirmation, cancellation, and the refusal message with its
  stop action.

### 2.180 Recent saved sessions in the rail

Status: planned
Blocked by: none

List each workspace's most recent saved sessions under its live sessions in the
rail and resume one from there.

Verification:

- Component-test the list, a saved session that is already live, an empty
  history, and a load failure.

### 2.181 Settings view

Status: planned
Blocked by: 2.171

Add the Settings destination, opened from the app menu with ⌘,, with
appearance, session notification, and keyboard sections that show each
setting's scope. Appearance covers theme, UI font, and the motion setting.

Verification:

- Component-test changing theme, font, motion setting, and notification policy,
  opening Settings with ⌘,, and a failed save.
- Storybook stories at desktop and narrow widths.

### 2.182 Agent readiness API

Status: planned
Blocked by: none

Report whether Pau found each supported agent executable, its version, and
whether Pi reports at least one available model.

Verification:

- Cover a found Pi with models, a found Pi without models, a missing
  executable, and an unsupported version against the Pi fixture.

### 2.183 First-run readiness view

Status: planned
Blocked by: 2.182

Show agent readiness in the empty Sessions view and direct the operator to run
`pi` in a Pau terminal when no provider is configured.

Verification:

- Component-test each readiness state and the terminal action.

## Composer

### 2.184 Pi composer keys

Status: planned
Blocked by: none

Match Pi's composer keys, using the operator's `keybindings.json` over Pi's
defaults. The defaults include Enter to send or steer, Alt+Enter to queue a
follow-up, Alt+Up to restore the queue, Shift+Tab to cycle thinking, and Ctrl+L
to open the model picker.

Verification:

- Component-test each default key while idle and while running, a key rebound
  in a fixture `keybindings.json`, and Esc closing a completion menu before it
  interrupts.
- Compare the key list against Pi's keybinding reference and record any
  deliberate difference in the user documentation.

### 2.185 Built-in Pi slash commands

Status: planned
Blocked by: 2.172

Complete and run Pi's built-in slash commands in the composer by mapping each to
its Pau action, and explain the commands that need vanilla Pi. `/fork` opens
the session tree's branch action.

Verification:

- Component-test completion, arguments for `/name`, `/model`, `/thinking`, and
  `/compact`, and an unavailable command with its reason.
- Run `/new`, `/name`, and `/compact` in a self-hosted session.

### 2.188 Drop target feedback

Status: planned
Blocked by: none

Show a drop target on the composer without resizing it, and reject unsupported
files before the drop with a reason.

Verification:

- Component-test entering, leaving, dropping an image, and dragging an
  unsupported file.

### 2.189 Composer external editor

Status: planned
Blocked by: 2.67

Open the composer draft in the preferred terminal or external editor with Ctrl+G
and put the saved text back in the composer.

Verification:

- Component-test a saved edit, a cancelled edit, and an editor that fails to
  start.

## Transcript

### 2.194 Stable transcript disclosures

Status: planned
Blocked by: none

Collapse finished tool blocks when the turn ends, never while it runs, and leave
tool and thinking blocks that the operator opened or closed as they left them.

Verification:

- Component-test a turn that ends with finished blocks, a manually opened block
  that stays open after the turn, a manually closed block that receives output,
  and Ctrl+O after the turn.
- Confirm the first visible entry does not move when a block above it finishes
  or collapses.

### 2.197 Prompt navigation

Status: planned
Blocked by: none

Move between user prompts in the transcript with Ctrl+Shift+Up and
Ctrl+Shift+Down.

Verification:

- Component-test moving between prompts, stopping at the first and last prompt,
  and leaving follow mode, with reduced motion on and off.

### 2.200 Session scroll restoration

Status: planned
Blocked by: none

Restore each session's scroll position or follow mode when the operator
returns to it.

Verification:

- Component-test switching between a followed session and a detached one and
  back.

### 2.201 Transcript history placeholder

Status: planned
Blocked by: 2.221

Show a static placeholder in transcript layout while history takes longer than
the busy delay to load.

Verification:

- Component-test a fast load with no placeholder and a slow load with one.

### 2.202 Streaming performance check

Status: planned
Blocked by: none

Replay a recorded 2,000-delta stream in Chromium and fail when a long task
exceeds 50ms or commits exceed one per frame.

Verification:

- Run the check against the current transcript and record its baseline.
- Confirm a deliberate per-delta re-render fails it.

### 2.203 Long transcript rendering

Status: planned
Blocked by: 2.202

Skip rendering of off-screen completed transcript entries with
`content-visibility` and a remembered intrinsic size.

Verification:

- Show an improvement in the streaming performance check on a long fixture.
- Confirm follow mode, search, and copying still work across skipped entries.

## Session status and attention

### 2.206 Attention navigation

Status: planned
Blocked by: 2.171

Jump to the next marked session with ⌘⌥A, taking waiting sessions first, then
failed, then unread.

Verification:

- Component-test jump order, wrapping past the last marked session, and no
  marked session.

### 2.207 Session change summary

Status: planned
Blocked by: none

Show the workspace's changed-file count and line totals in the session header
and open the inspector's Changes tab from it.

Verification:

- Component-test a clean tree, a dirty tree, a non-Git workspace, and a Git
  status failure.

### 2.208 Session archive

Status: planned
Blocked by: none

Store an archived flag for stopped sessions in Pau's database without changing
native session files.

Verification:

- Cover archiving, restoring, refusing a live session, and that native files
  stay unchanged.

### 2.209 Session archive view

Status: planned
Blocked by: 2.181, 2.208

Let the operator archive a stopped session from the rail and restore it from
Settings.

Verification:

- Component-test archive, restore, and the disabled control on a live session.

### 2.210 Long-operation progress

Status: planned
Blocked by: 2.221

Show elapsed time for compaction and session start, and the attempt number and
next attempt time for automatic retries.

Verification:

- Component-test compaction, a retry countdown, and cancel where the session
  supports it, using fake timers.

## Review

### 2.211 Diff comments to the composer

Status: planned
Blocked by: none

Let the operator comment on diff lines and add those comments to the current
session's composer draft as quoted blocks with path and line.

Verification:

- Component-test adding, editing, and removing comments, and inserting several
  into a draft.

### 2.212 Hunk stage and revert

Status: planned
Blocked by: 2.54

Stage, unstage, and revert a hunk or file through Git and record each change in
the mutation audit.

Verification:

- Cover each operation, a conflicting hunk, a binary file, and a file that
  changed after the diff was read.

### 2.213 Hunk stage and revert view

Status: planned
Blocked by: 2.212

Add stage, unstage, and revert controls to diff review, with confirmation for
revert.

Verification:

- Component-test each control, revert cancellation, and a stale-diff failure.

### 2.214 Diff update highlight

Status: planned
Blocked by: none

Tint diff hunks that change while a session runs, fading the tint over one
second.

Verification:

- Component-test a live hunk update, an unchanged hunk, and the static marker
  under reduced motion.

## Workspace commands

### 2.215 Workspace run commands

Status: planned
Blocked by: none

Read named setup and run commands from a checked-in workspace file and start
each one in a new terminal on request. Never run a command automatically.

Verification:

- Cover a valid file, an invalid file, a missing file, and a command that
  exits with an error.

### 2.216 Run command controls

Status: planned
Blocked by: 2.96, 2.215

Show a workspace's run commands in the session header and the palette and open
each in the terminal dock.

Verification:

- Component-test running a command, a failed command, and a workspace without
  commands.

## Polish and motion

### 2.219 Overlay focus restoration

Status: planned
Blocked by: none

Return focus to the invoking control when a dialog, popover, or overlay rail
closes, or to the composer when the invoker is gone.

Verification:

- Component-test closing each overlay with Escape, with its close control, and
  after its invoker has unmounted.

### 2.220 Focus ring consistency

Status: planned
Blocked by: none

Use one focus-ring token, width, and offset across every focusable control,
without clipping inside scroll containers.

Verification:

- Component-test focus-visible styling on representative controls in a
  scrolled transcript, the composer, and each overlay.
- Run Storybook accessibility checks for each changed story.

### 2.221 Busy indicator timing

Status: planned
Blocked by: none

Delay loading and busy indicators by 400ms and keep them visible for at least
500ms once shown.

Verification:

- Unit-test the timing with fake timers, including a wait that ends before the
  delay and one that ends during the minimum display.
- Apply it to the session-list loading state and confirm a fast load shows no
  indicator.

### 2.222 Disclosure motion

Status: planned
Blocked by: 2.194

Animate tool and thinking block expansion for finished blocks shorter than one
viewport, and switch instantly otherwise.

Verification:

- Component-test that a short finished block animates, a streaming or tall
  block does not, and reduced motion removes the animation.
- Check the animation in WebKit.

### 2.223 Inspector toggle

Status: planned
Blocked by: none

Open and close the wide inspector and context rail without per-frame
transcript reflow, fading their content in.

Verification:

- Component-test toggling from the top app bar and the keyboard, and that the
  keyboard path is instant.

### 2.224 Narrow overlay motion

Status: planned
Blocked by: none

Slide the narrow context rail and inspector overlay from their edges over a
fading scrim.

Verification:

- Component-test opening, closing by scrim click and Escape, and the fade-only
  presentation under reduced motion.

### 2.225 Popover presentation

Status: planned
Blocked by: none

Fade and scale pointer-opened pickers and meters from their anchor, keep
keyboard-opened completion lists instant, and close any open popover before
another opens.

Verification:

- Component-test the model picker, thinking-level picker, and context meter
  opened by pointer and keyboard, and opening one while another is open.

### 2.226 Dialog presentation

Status: planned
Blocked by: 2.219

Fade and scale extension dialogs in and out, keeping each mounted until its
exit finishes.

Verification:

- Component-test opening, confirming, cancelling, and a new request arriving
  while the previous dialog exits.

### 2.227 Task-surface transition

Status: planned
Blocked by: none

Fade new task surfaces in with a small offset when the operator navigates by
pointer, and switch instantly from the keyboard.

Verification:

- Component-test that the incoming surface is interactive at once and that the
  keyboard path and reduced motion skip the offset.

### 2.228 Notification toasts

Status: planned
Blocked by: none

Show extension and application notices as dismissible toasts that pause on
hover and focus and keep errors until dismissed.

Verification:

- Component-test auto-dismissal with fake timers, pausing, error persistence,
  and stacking beyond three.

### 2.229 Terminal tab continuity

Status: planned
Blocked by: none

Switch terminal tabs instantly while preserving each tab's scroll position and
focus.

Verification:

- Component-test switching between tabs with scrollback and returning to the
  previous scroll position and focus.

### 2.230 Hover and press states

Status: planned
Blocked by: none

Use token-driven color changes for hover and press on every control, with no
press movement in dense rows.

Verification:

- Confirm each control class in Storybook has hover, press, focus, and
  disabled states, and that hover is absent under `(hover: none)`.

### 2.231 Desktop pointer and selection

Status: planned
Blocked by: none

Use the arrow cursor on controls and make application chrome unselectable
while transcript, code, paths, and errors stay selectable.

Verification:

- Component-test that a drag across the rail selects nothing and that
  transcript text remains copyable.

### 2.232 Increased contrast

Status: planned
Blocked by: none

Strengthen rules, muted text, and focus rings under `prefers-contrast: more`,
and use system colors under `forced-colors: active`.

Verification:

- Component-test computed rule width and focus ring width with each media
  query emulated.
- Check every shipped theme in Storybook.

## Pi desktop parity

### 2.158 Sandboxed live Pi sessions

Status: planned
Blocked by: none

Start live Pi sessions inside the workspace's selected sandbox instead of
refusing them.

Verification:

- Start a sandboxed session through the desktop API against the fake Pi
  executable and confirm its tools run inside the sandbox.
- Confirm a sandbox that cannot start fails the session start with its reason.

### 2.150 Session rename and clone controls

Status: planned
Blocked by: none

Add rename and clone controls to the session view.

Verification:

- Component-test renaming, cloning, and a failed rename.

### 2.153 Attention notifications

Status: planned
Blocked by: none

Send a native notification and badge the app icon when a session waits for
input or fails while its view is not focused.

Verification:

- Component-test which session states notify and that a focused session does
  not.
- Trigger a notification from a self-hosted Pi session.

### 2.115 Pi shell context API

Status: planned
Blocked by: none

Expose Pi shell context through the desktop API.

Verification:

- Cover shell context against the Pi fixture.

### 2.116 Composer shell context

Status: planned
Blocked by: 2.115

Add shell context to the session composer.

Verification:

- Component-test shell context and its unsupported state.

### 2.167 Transcript history details

Status: planned
Blocked by: none

Show compaction summaries loaded from Pi's history as compaction markers, and
show images attached to user prompts in the transcript.

Verification:

- Component-test a history with a compaction summary and a user prompt with an
  image, both from history and from live events.

### 2.121 Pi transcript export API

Status: planned
Blocked by: none

Expose transcript export through the desktop API.

Verification:

- Cover export and export failure against fixture Pi session files.

### 2.122 Transcript export

Status: planned
Blocked by: 2.121

Add transcript export to the session view.

Verification:

- Component-test export and export failure.
- Export a self-hosted Pi session.

### 2.233 External links

Status: planned
Blocked by: none

Open links from transcripts and other views in the operator's default browser
from the desktop app.

Verification:

- Component-test that a transcript link asks the desktop shell to open it, and
  that unsafe schemes are refused.
- Open a link from a self-hosted session transcript.

### 2.234 Workspace file name search API

Status: planned
Blocked by: none

Search workspace file and folder names, honoring ignore rules, through the
desktop API so file mentions cover large workspaces without walking folders
from the client.

Verification:

- Cover ranked name matches, ignored and hidden files, a result limit, and a
  large fixture tree.

### 2.40 Pi TUI parity and primary dogfood gate

Status: planned
Blocked by: 2.156, 2.175, 2.184, 2.185, 2.194, 2.197, 2.200, 2.219, 2.220

Confirm that the desktop app covers vanilla Pi's interactive workflows, then do
normal project work through Pau. Use vanilla Pi in the persistent terminal only
for terminal-specific extension components.

Verification:

- Audit the current Pi TUI actions and RPC commands against the implemented Pau
  controls, recording unsupported native capabilities with an explanation.
- Complete normal project work through Pau using configured skills, prompts,
  extensions, MCP tools when installed, queued messages, compaction, session
  branching, review, CodeMirror, and the persistent terminal in the installed
  macOS build.

**Primary dogfood replacement point:** When 2.40 is complete, Pau replaces
vanilla Pi with `pi-mcp-adapter` in a terminal for routine Pi work, including
MCP. Vanilla Pi remains available in Pau's persistent terminal for terminal-only
extension components. Pau is also the primary dogfood interface for routine
Claude work. Deep editor embedding and Linux release packaging remain later
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

### 2.34 Resource browser

Status: planned
Blocked by: none

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
Blocked by: none

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
Blocked by: 2.54

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

Website units apply the approved public-site direction from the `docs` page of
the `pau.fig` design file and its exports in `dev/prototype` to
`apps/website`. Keep available behavior distinct from planned work, and keep
the prototype's view switcher out of the public navigation. Review each website
unit at desktop and narrow widths in light and dark themes.

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
Blocked by: 2.140, 2.141, 2.142, 2.143

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

### 2.156 macOS dogfood build

Status: blocked
Status note: The release script and unsigned build work. Signing needs a
Developer ID Application certificate, which the development Mac lacks.
Blocked by: none

Build a signed and notarized Apple Silicon app from a release tag and install
it in `/Applications`.

Verification:

- Build, sign, notarize, and install a tagged release on the development Mac.
- Launch it and confirm Gatekeeper accepts it and the reported version matches
  the tag.
- Confirm a startup failure, such as a database from a newer version, shows its
  message in a native dialog instead of quitting silently.

### 2.39 AppImage packaging

Status: planned
Blocked by: 2.40, 2.45, 2.51

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
