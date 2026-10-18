# 2. Desktop app: Workspaces and navigation

## Shell and navigation

### 2.243 Scoped Pi bindings

Status: planned
Blocked by: none

Let Pi's text-editing bindings take a chord from Pau only while the composer has
focus, and keep Pi's application bindings taking it everywhere, as the keyboard
rules in `dev/design/system.md` describe. Show where each yielded chord applies
in the shortcut list.

Verification:

- Component-test on Linux that Ctrl+K opens the command palette outside the
  composer and is left to the text field inside it, that Ctrl+Shift+P still
  yields to Pi everywhere, and that an operator binding which moves a
  text-editing action to another chord frees Ctrl+K.

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
Blocked by: none

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

## Workspace files

### 2.234 Workspace file name search API

Status: planned
Blocked by: none

Search workspace file and folder names, honoring ignore rules, through the
desktop API so file mentions cover large workspaces without walking folders
from the client.

Verification:

- Cover ranked name matches, ignored and hidden files, a result limit, and a
  large fixture tree.

## Worktrees

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
