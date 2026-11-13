# Agent desktop UX research

This note compares the desktop agent apps that Pau's operators already know and
turns the comparison into a shell, flows, a key map, and roadmap proposals. It
was written on 2026-10-17 against the documentation available that day. The
goal it serves is near term: Pau must be a viable daily replacement for Pi's
terminal UI before it grows into an orchestrator for Claude Code, Codex, and
other agents.

The three main references are the Codex app, Claude Code in the Claude desktop
app, and Conductor. Zed, Cursor, and Superset appear where they add a pattern
the others lack.

## What each app does that matters for Pau

### Codex app

Codex now ships inside the ChatGPT desktop app. The docs call its units
"projects" and "chats"; older material says "threads"
([ChatGPT desktop app](https://learn.chatgpt.com/docs/app.md),
[Codex app guide](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)).

- Organization: the sidebar groups chats under projects. A project can hold
  several folders, one of them primary. Chats without a project sit under
  Recents. Projects and chats can be pinned, and archived chats are restored
  from Settings
  ([Projects and chats](https://learn.chatgpt.com/docs/projects.md)).
- Run location: each chat runs in **Local**, **Worktree**, or **Cloud**. The
  worktree option sits under the composer with a base-branch picker. If the
  chosen branch has uncommitted changes, Codex copies them into the new worktree
  ([Codex environments](https://learn.chatgpt.com/docs/environments/modes.md),
  [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md)).
- Worktree lifecycle: **Hand off** moves a chat and its code between Local and
  its worktree. **Create branch here** names a branch for a detached worktree.
  Codex keeps the 15 most recent managed worktrees by default and deletes a
  worktree when its chat is archived, after saving a snapshot that can be
  restored. Pinned, running, and permanent worktrees are never deleted
  automatically. `.worktreeinclude` lists ignored files to copy into new
  worktrees.
- Local environments: a `.codex` folder holds per-platform setup scripts that
  run when a worktree is created, and **actions** that appear as top-bar buttons
  and run in the integrated terminal
  ([Local environments](https://learn.chatgpt.com/docs/environments/local-environment.md)).
- Review pane: scopes are **Unstaged**, **Staged**, **Commit**, **Branch**, and
  **Last turn**. The operator comments inline with a **+** on a line, then sends
  a chat message so Codex acts on the comments. Stage and revert work per hunk,
  per file, or for the whole diff. `/review` runs an agent review whose findings
  appear as inline comments
  ([Code review](https://learn.chatgpt.com/docs/code-review.md)).
- Permissions: **Ask for approval**, **Approve for me** (routes eligible
  requests to an automatic reviewer without widening the sandbox), and **Full
  access**. The approval control sits below the composer. Enter approves and Esc
  declines a request
  ([Permissions](https://learn.chatgpt.com/docs/permission-modes.md),
  [Commands](https://learn.chatgpt.com/docs/reference/commands.md)).
- Attention: turn-completion alerts can be off, background-only, or always,
  with separate switches for permission and question alerts. The **Activity**
  view lists unread, running, and waiting chats. Shift+Esc clears unread marks
  ([Notifications](https://learn.chatgpt.com/docs/notifications.md)).
- Terminal: every chat has its own terminal scoped to its project or worktree,
  and the agent can read its current output
  ([Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal.md)).
- Keyboard: the published map is the most complete of the three. It has a
  command menu (⌘K or ⌘⇧P), go to chat 1–9, next chat needing attention (⌘⌥A),
  archive (⌘⇧A), mark unread, pin, rename, find in chat, file search (⌘P), and
  a review tab. Deep links such as `codex://threads/<id>` and
  `codex://new?path=…&prompt=…` open chats from other tools
  ([Commands](https://learn.chatgpt.com/docs/reference/commands.md)).

### Claude Code in the Claude desktop app

The **Code** tab runs the same engine as the CLI, reads the same `CLAUDE.md`,
settings, hooks, skills, and MCP configuration, and can resume CLI sessions with
`/resume`
([Use Claude Code Desktop](https://code.claude.com/docs/en/desktop.md),
[desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart.md)).

- First run: sign in, open the Code tab, choose **Local**, click **Select
  folder**, pick a model, and type. Four choices sit in the prompt area before
  the first message: environment, project folder, model, and permission mode.
- Organization: a sidebar of sessions, filterable by status, project, or
  environment and groupable by project. **+ New session** is ⌘N.
  Ctrl+Tab cycles sessions. ⌘-click opens a second session in a side-by-side
  pane. Sessions can be renamed from the toolbar title and archived from a
  hover icon, with an optional auto-archive after the PR merges or closes.
- Worktrees: a **worktree** toggle next to the branch name. The default location
  is `<project-root>/.claude/worktrees/`, with a configurable branch prefix and
  `.worktreeinclude` for ignored files.
- Prompt box: Enter sends. Esc or the stop button interrupts. Typing a
  correction and pressing Enter while Claude works delivers it after the current
  action, which matches Pi's steering. `@file` mentions, attachments, and a
  usage ring for context sit in the same box.
- Permission modes: **Manual**, **Accept edits**, **Plan**, **Auto**, and,
  once enabled, **Bypass permissions**. The mode is remembered per folder and ⌘⇧M
  opens its menu. In Manual mode each proposed edit shows a diff with Accept and
  Reject.
- Transcript modes: **Normal** collapses tool calls, **Thinking** adds
  reasoning, and **Verbose** shows every step. Ctrl+O cycles them.
- Review: a `+12 -1` indicator in the session opens a diff pane with a file list.
  Clicking a line adds a comment, and ⌘Enter sends all comments back for Claude
  to revise. `/code-review` produces a findings card with **Walk through in
  diff**, **Fix this one**, and **Apply fixes**.
- PR flow: after a PR opens, a CI status bar offers **Auto-fix CI & address
  comments** and **Auto-merge when ready**, using the GitHub CLI.
- Panes: chat, diff, terminal (Ctrl+\`), file, browser preview, plan, tasks,
  and subagent panes can be dragged, resized, closed with ⌘\\, or popped out.
  A side chat (⌘;) asks a question without adding to the main thread.
- Attention: an OS notification fires when a session finishes while another is
  in view. Requests that arrive while an SSH session is disconnected wait on the
  remote process and reappear on reconnect if Desktop can rejoin it.
- Shortcut help: ⌘/ lists shortcuts.

### Conductor

Conductor is a Mac app that runs Claude Code, Codex, Cursor, and OpenCode in
parallel, one Git worktree per workspace
([Conductor docs](https://www.conductor.build/docs)).

- Model: a project holds one repository, which holds many workspaces. Each
  workspace has one branch, one working tree, and its own running processes. The
  workspace is the unit of delegation and the branch or PR is the unit of
  integration
  ([Isolated workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches),
  [Workflow](https://www.conductor.build/docs/concepts/workflow)).
  Workspaces are named by branch with a city name as the directory.
- First run: **Open project**, **Open GitHub project**, or **Quick start**.
  Conductor creates the first workspace immediately and uses `gh` from the
  terminal environment
  ([Your first workspace](https://www.conductor.build/docs/first-workspace)).
- Creation: ⌘⇧N creates a workspace from a branch, PR, GitHub issue, or Linear
  issue. New branches start from a freshly fetched base branch, and the first
  chat asks the agent to rename the branch. Several agent tabs can share one
  workspace when they should see the same files.
- Scripts: `setup` runs after creation, `run` backs the **Run** button, and
  `archive` runs before archiving. `run_mode = "nonconcurrent"` stops other run
  scripts first when workspaces share a port or database. `CONDUCTOR_PORT`
  gives each workspace its own port
  ([Scripts](https://www.conductor.build/docs/reference/scripts)).
- Review and merge: the Diff Viewer (⌘⇧D) supports line comments that become
  composer attachments, file revert, unified view, and per-commit filtering. A
  **Review** action asks an agent for review. The **Checks** tab gathers Git
  status, PR metadata, CI, deployments, review threads, and todos, and open
  todos block merge. ⌘⇧P creates a PR. Archived workspaces and their chats come
  back from a History pane
  ([Review and merge](https://www.conductor.build/docs/guides/review-and-merge),
  [Checks](https://www.conductor.build/docs/reference/checks),
  [Todos](https://www.conductor.build/docs/reference/todos)).
- Checkpoints: before each turn Conductor records the working tree in a private
  Git ref. Reverting from a user message deletes that turn and every later one
  and restores the files
  ([Checkpoints](https://www.conductor.build/docs/reference/checkpoints)).
- Sidebar: each workspace shows Git and GitHub state (merged, failing CI,
  conflicts), a permission-needed indicator, and unread chats; clicking a
  selected workspace jumps to its oldest unread chat. Workspaces also carry a
  backlog, in-progress, in-review, or done status
  ([0.44.0](https://www.conductor.build/changelog/0.44.0-new-sidebar-rebuilt-composer-codex-checkpoints),
  [0.35.0](https://www.conductor.build/changelog/0.35.0-workspace-status)).
- Fork: forking a workspace creates a new one with the changes up to the fork
  point and a summary of the chat, not the chat itself
  ([0.25.6](https://www.conductor.build/changelog/0.25.6-multiple-git-repos-fork-workspaces)).
- Keyboard: ⌘/ opens the shortcut list, `j`/`k` move through the chat, `[` and
  `]` toggle the sidebars, and a command palette exists
  ([0.28.0](https://www.conductor.build/changelog/0.28.0-workspaces-page-claude-s-context-interactive-planning-keyboard-nav-and-more)).
- Terminal-first escape hatch: **Big Terminal Mode** (⌘⇧T) replaces the center
  panel with a terminal whose tabs can start agent presets, including `pi`
  ([Big Terminal Mode](https://www.conductor.build/docs/reference/big-terminal-mode)).
- Conductor states that workspace isolation is development isolation, not a
  security boundary. Agents run with the user's permissions
  ([Security and permissions](https://www.conductor.build/docs/reference/security-and-permissions)).

### Peers

- Zed's agent panel queues messages sent during generation and offers
  **Steer** for its own agent. It reviews edits in a multibuffer with per-hunk
  accept and reject, shows **Restore Checkpoint** above a message after an edit,
  and can follow the agent from file to file. It notifies when generation ends
  while Zed is in the background
  ([Zed agent panel](https://zed.dev/docs/ai/agent-panel)).
- Cursor 2.0 added an agent-first layout with a sidebar of agents and plans and
  can run several agents on one prompt in separate worktrees
  ([Cursor changelog](https://cursor.com/changelog/page/2)).
- Superset keeps sessions alive in a daemon across app restarts and creates a
  worktree per task
  ([Superset worktrees](https://superset.sh/blog/working-with-worktrees-in-superset)).

### Patterns all three share

- The sidebar answers "what needs me?" with status, unread state, and a
  waiting-for-permission mark on each item.
- Opening a folder is the first action, and the composer is ready right after.
- Enter sends and Esc interrupts. Claude desktop also delivers a message typed
  during a run after the current action, which is Pi's steering.
- A change count in the session opens a diff. Line comments go back to the
  agent as structured feedback.
- Worktree isolation is a per-session or per-workspace choice made at creation,
  and `.worktreeinclude` is the shared format for copying ignored files.
- Archive hides finished work and can be undone. Nothing is deleted without an
  explicit action, except Codex's managed worktrees, which are snapshotted
  first.
- ⌘/ shows the shortcut list, and a command palette reaches every action.

## Pattern comparison

| Pattern                  | Codex                                          | Claude desktop                            | Conductor                                   | Pau today                                                          |
| ------------------------ | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Top-level grouping       | Projects with chats                            | Sessions, grouped by project on request   | Projects, then workspaces (one branch each) | Workspaces with live sessions in the context rail                  |
| Open a repository        | ⌘O, project menu                               | **Select folder** in the prompt area      | Open project, GitHub project, Quick start   | 2.169 in progress; no control in the shipped app                   |
| Isolation choice         | Local, Worktree, or Cloud per chat             | Worktree toggle per session               | Always a new worktree                       | Workspace may be a worktree; creation and attachment planned       |
| Ignored files            | `.worktreeinclude`                             | `.worktreeinclude`                        | Files to copy, `.worktreeinclude`           | None                                                               |
| Setup and run scripts    | Setup scripts and top-bar actions              | `.claude/launch.json` dev servers         | setup, run, archive scripts                 | None                                                               |
| Resume history           | Sidebar, Recents                               | Sidebar, `/resume` for CLI sessions       | History pane, Workspaces page               | **Saved** picker per workspace                                     |
| Fork                     | Not documented for desktop                     | Supported; documented under SSH limits    | Fork workspace with chat summary            | Tree branch inside a session; no fork to a new session             |
| Rename                   | ⌘⌥R                                            | Click title                               | Branch rename by agent                      | Backend exists; control planned (2.150)                            |
| Archive                  | ⌘⇧A, restore in Settings                       | Hover icon, auto-archive after PR         | Archive, restore from History               | None; stop only                                                    |
| Send and steer           | Enter                                          | Enter; Enter during a run steers          | Enter                                       | ⌘Enter; delivery selector for steer or follow-up                   |
| Transcript detail        | Not documented                                 | Normal, Thinking, Verbose (Ctrl+O)        | Not documented                              | Thinking and tools as disclosure rows; plain-text messages         |
| Approvals                | Ask, Approve for me, Full access; Enter or Esc | Manual, Accept edits, Plan, Auto, Bypass  | Optional tool approvals                     | Off by default by design; prompts planned (2.45, 2.62)             |
| Diff review              | Review pane with five scopes                   | Diff pane from `+N -M` indicator          | Diff Viewer (⌘⇧D)                           | Editor surface diff with hunk marking; not linked from the session |
| Line comments to agent   | Yes                                            | Yes, ⌘Enter sends                         | Yes, as composer attachments                | None                                                               |
| Stage or revert hunks    | Hunk, file, all                                | Not documented                            | Revert files                                | None                                                               |
| PR and CI                | Commit, push, PR                               | CI bar, auto-fix, auto-merge              | Create PR (⌘⇧P), Checks tab                 | None                                                               |
| Checkpoints              | Worktree snapshot before deletion              | Not documented in desktop                 | Private Git ref per turn                    | None                                                               |
| Terminal                 | Per chat, readable by agent                    | Pane per session (Ctrl+\`)                | Per workspace, Big Terminal Mode            | Per-workspace tabs on their own route                              |
| Notifications            | Completion, permission, question settings      | Finished while another session is in view | Not documented                              | Planned (2.153)                                                    |
| Attention navigation     | Activity view, next attention (⌘⌥A), unread    | Status filter                             | Unread jump, permission mark                | Attention dot in rail; no unread or jump                           |
| Command palette          | ⌘K or ⌘⇧P                                      | Not documented                            | Yes                                         | Search field in the command bar does nothing                       |
| Shortcut help            | ⌘/                                             | ⌘/                                        | ⌘/                                          | None                                                               |
| Deep links               | `codex://`                                     | `claude --desktop --resume <id>`          | `conductor://`                              | Route URLs inside the app only                                     |
| Several agents, one tree | Not documented                                 | Side-by-side panes                        | Agent tabs in one workspace                 | Several sessions per workspace                                     |

## Recommended shell and flows

Pau's frame already has the right regions: a command bar, a product rail, a
context rail, one main surface, an optional inspector, and a terminal dock. The
work is to make each region carry the patterns above without breaking Pau's
rules from [`dev/spec`](../spec/overview.md):

- Native session files stay authoritative. Pau caches and hides; it never
  deletes agent history as a side effect.
- Every process Pau starts is visible as a session, terminal, or process row.
- Controls come from adapter capabilities. A missing capability hides or
  disables the control with a reason.
- Permission prompting and sandboxing are off by default. A session without a
  confirming profile behaves like vanilla Pi.
- Destructive Git, worktree, and file operations are explicit and audited.

### Regions

The command bar shows the workspace and branch of the current view, the palette
trigger, the rail, inspector, and terminal toggles, and the connection state.
The search field becomes the palette trigger instead of a separate input.

The product rail keeps a short list of destinations: Sessions, Files, Terminal,
Processes, and Resources, with Settings pinned at the bottom and Diagnostics
shown only while diagnostics mode is on. The sandbox view belongs under
workspace settings and the session launch flow rather than the rail, because
operators visit it once per workspace. A destination that has no implementation
yet stays out of the rail.

The Sessions context rail is the equivalent of the Codex and Claude sidebars:

- One group per repository. A workspace that is a linked worktree nests under
  its repository and shows its branch. A plain directory is its own group.
- Each group header has a start-session button, a new-worktree button, and a
  menu with Reveal in Finder, Open in editor, Open terminal, and Remove from Pau.
- Live sessions list first, each with a status dot and text, an unread mark,
  and a waiting-for-permission mark when a confirming profile is active.
- Up to five recent saved sessions follow under a collapsed **Recent** heading,
  with **Show all** opening the saved-session picker. This replaces the
  separate **Saved** button as the main resume path.
- **Open folder** sits at the bottom of the rail and in the empty state.

The main surface shows one session. Its header holds the inline-editable title,
agent and model chips, the thinking level, the context meter, and a change
summary such as `+42 −7 in 3 files` from the workspace's Git status. The change
summary opens the inspector's Changes tab.

The inspector has tabs for Changes, Tree, and Process, and a Permissions tab
when a confirming profile is active. It shows detail for the current session
and never becomes a second session list.

The terminal dock opens the current workspace's terminals under the main column
(2.96). The Terminal destination remains for full-surface use, in the same way
as Conductor's Big Terminal Mode.

### First run

1. Launch shows the existing splash states, then an empty Sessions view.
2. The empty view offers **Open folder** (⌘O) and lists the readiness of each
   agent: the Pi executable and version Pau found, and whether Pi reports any
   available model. A missing provider links to running `pi` in a Pau terminal
   for `/login`, since Pi's RPC has no login command.
3. After the operator chooses a folder, Pau registers it, selects it, and shows
   the composer with focus. If Pi already has sessions for that directory, the
   **Recent** list shows them at once.
4. The first prompt starts the session. No modal wizard sits in front of the
   composer.

A later launch reopens the last workspace and session route. If that session is
no longer live, Pau shows it from history with a **Resume** action instead of
resuming it automatically.

### Workspaces and worktrees

- **Open folder** registers a directory. **Remove from Pau** forgets the
  registration and leaves the files alone. Removal is refused while the
  workspace has live sessions or terminals, with a reason and a stop action.
- **New worktree** (⌘⇧N) asks for a branch name, a base branch, and a location.
  The dialog shows the exact `git worktree add` command and target path before
  it runs (2.105, 2.106). Pau should honor `.worktreeinclude` because Claude
  desktop, Codex, and Conductor already use it. The dialog lists which ignored
  files it will copy.
- **Attach worktree** registers an existing worktree (2.27, 2.104).
- Pau never deletes a worktree or branch automatically. Archiving a worktree
  workspace is a separate explicit action that reports uncommitted changes and
  unpushed commits first.
- Per-workspace setup and run commands, like Conductor's scripts and Codex's
  actions, are a later addition. When they arrive, they run in visible terminal
  tabs, never as hidden processes.

### Session lifecycle

| Action          | Trigger                               | Effect                                                                   | Pi equivalent              |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| New             | ⌘N, rail +, `/new`                    | Starts a Pi process in the selected workspace                            | `/new`                     |
| Resume          | ⌘P, Recent list, `/resume`            | Opens a saved session, or selects it if it is already live               | `/resume`, `--continue`    |
| Rename          | F2 in the rail, header title, `/name` | Sets the native session name                                             | `/name`                    |
| Branch in place | Tree tab, prompt hover, `/tree`       | Moves within the session tree and puts the prompt back in the composer   | `/tree`                    |
| Fork            | Prompt hover, Tree tab, `/fork`       | Creates a new session from an earlier user message                       | `/fork`                    |
| Clone           | Palette, `/clone`                     | Copies the active branch into a new session                              | `/clone`                   |
| Close view      | ⌘W                                    | Leaves the view; the process keeps running                               | Detach (no TUI equivalent) |
| Stop            | Palette, header menu                  | Stops the Pi process; the session stays in Recent                        | `/quit`                    |
| Archive         | ⌘⇧A, rail menu                        | Hides a stopped session from the rail in Pau only; the file is untouched | None                       |

Closing a view must never stop work, and stopping must never delete history.
Stop has no single-key shortcut. Archive applies only to stopped sessions, and
the archived list in Settings restores them.

### Thread view

- Assistant messages render as Markdown with highlighted code blocks. User
  messages keep their line breaks and attached images (2.167).
- Thinking stays collapsed once complete. Ctrl+T toggles all thinking blocks, as
  in Pi.
- Each tool call is one row with a summary that fits the tool: the command for
  `bash`, the path and `+n −m` for `edit` and `write`, and the path for `read`.
  Expanding a row shows a diff for edits and the command output for `bash`.
  Ctrl+O toggles all tool rows, as in Pi. This needs structured tool arguments
  from the backend instead of a single detail string.
- The transcript follows new output while it is scrolled to the bottom. Once
  the operator scrolls up, it stops following and shows **Jump to latest**.
- Ctrl+Shift+Up and Ctrl+Shift+Down move between user prompts, as Pi's
  fullscreen mode does. Home and End jump to the ends.
- A user prompt offers Fork from here, Branch here, and Copy on hover and from
  the keyboard. An assistant message offers Copy.
- Compaction markers, sandbox denials, retries, and extension dialogs keep their
  current inline placement.

### Approvals

The roadmap already owns the behavior (2.45, 2.62, 2.63, 2.64, 2.82, 2.83). The
shell adds placement and keys:

- The request card appears inline at the point in the transcript where the tool
  waits, and the composer shows that the turn is blocked on it.
- The rail marks the session as waiting, the inspector's Permissions tab lists
  its queue, and 2.153 sends the notification when the session is not in view.
- With the card focused, Enter allows once, Shift+Enter allows for this session,
  and Esc denies. Focus moves to the card when it appears in the visible
  session. Denial is the default on timeout or disconnect.
- Copy calls unsandboxed controls guardrails, as the spec requires.

Pau should not copy Claude's Bypass or Codex's Full access as a mode. In Pau,
"no prompts" is the default profile, and that is already the equivalent.

### Review and merge

- The change summary in the session header opens the Changes tab: changed files
  from Git status and a diff for the selected file, using the existing
  `DiffReview` component.
- The Editor surface stays the full review surface with the file tree and
  CodeMirror.
- Line comments are the most useful addition from all three apps. A comment on
  a diff line becomes a quoted block in the composer draft with the path and
  line, and the operator decides when to send it.
- Stage and revert per hunk and per file come next, through Git commands that
  the mutation audit (2.54) records.
- Commit, push, PR creation, and CI tracking stay in the terminal or the
  external editor for now. Conductor and Claude show how far this can go, but
  each step adds GitHub credentials and remote state to Pau.

### Attention and notifications

- Each session shows its status as a dot and text. Sessions that finished a turn
  or failed while out of view are marked unread until opened.
- ⌘⌥A jumps to the next session that is waiting, failed, or unread, oldest
  first. Shift+Esc clears unread marks.
- 2.153 provides the native notification and app badge. Settings choose between
  never, background only, and always for turn completion, with a separate switch
  for waiting and failed sessions, following Codex.
- The design's Dashboard surface can later list waiting, running, and unread
  sessions across workspaces. The rail and the jump key cover the need first.

### Keyboard model

A Pi TUI user must be able to drive Pau without the mouse. The key map follows
three rules:

1. Composer keys copy the defaults in Pi 1.0's `docs/keybindings.md`, so
   muscle memory carries over.
2. App-level shortcuts use ⌘ on macOS and follow the conventions that Codex,
   Claude desktop, and Conductor already agree on.
3. Every action in the key map is also a palette command, and the palette shows
   its shortcut.

On Linux, ⌘ maps to Ctrl, which collides with Pi's Emacs-style editing keys such
as Ctrl+K and Ctrl+P. Pau reads Pi's `keybindings.json`, and when an app
shortcut collides with one of the operator's Pi bindings, the Pi binding wins.

Global:

| Key                      | Action                                               |
| ------------------------ | ---------------------------------------------------- |
| ⌘K, ⌘⇧P                  | Command palette                                      |
| ⌘/                       | Shortcut list                                        |
| ⌘O                       | Open folder                                          |
| ⌘N                       | New session in the current workspace                 |
| ⌘⇧N                      | New worktree                                         |
| ⌘P                       | Go to session (live and saved, fuzzy)                |
| ⌘1 to ⌘9                 | Go to the nth session in rail order                  |
| Ctrl+Tab, Ctrl+Shift+Tab | Next or previous session                             |
| ⌘⌥A                      | Next session needing attention                       |
| Shift+Esc                | Clear unread marks                                   |
| ⌘W                       | Close the session view without stopping it           |
| ⌘⇧A                      | Archive the selected stopped session                 |
| ⌘B                       | Toggle the context rail                              |
| ⌘⌥B                      | Toggle the inspector                                 |
| Ctrl+\`, ⌘J              | Toggle the terminal dock                             |
| ⌘⇧D                      | Open the Changes tab                                 |
| ⌘⇧F                      | Focus mode                                           |
| ⌘L                       | Focus the composer                                   |
| F6, Shift+F6             | Move focus between rail, main surface, and inspector |
| ⌘F                       | Find in transcript (2.81)                            |
| ⌘[ and ⌘]                | Back and forward through visited views               |
| ⌘,                       | Settings                                             |

Composer, matching Pi:

| Key                  | Action                                                  |
| -------------------- | ------------------------------------------------------- |
| Enter                | Send; during a run, steer                               |
| Alt+Enter            | Queue a follow-up                                       |
| Shift+Enter, Ctrl+J  | New line                                                |
| Esc                  | Interrupt a running turn; close a completion menu first |
| Up, Down             | Prompt history at the first or last line                |
| Alt+Up               | Restore queued messages to the composer                 |
| Tab                  | Complete a slash command or path                        |
| Shift+Tab            | Cycle the thinking level                                |
| Ctrl+L               | Open the model picker                                   |
| Ctrl+P, Ctrl+Shift+P | Cycle models                                            |
| Ctrl+T               | Collapse or expand thinking                             |
| Ctrl+O               | Collapse or expand tool output                          |
| Ctrl+C               | Clear the composer (never quits Pau)                    |
| Ctrl+X               | Copy the last assistant message                         |
| Ctrl+V               | Paste an image or text                                  |
| Ctrl+G               | Edit the draft in the preferred external editor         |
| Ctrl+Shift+Up, Down  | Previous or next user prompt in the transcript          |

Lists such as the rail, pickers, and the tree use Up and Down or `j` and `k`,
Enter to open, Left and Right to collapse and expand, F2 to rename, and `/` to
filter.

Slash commands must cover Pi's built-in commands as well as extension commands,
prompts, and skills. Pi's RPC `get_commands` returns only the latter, so Pau
handles the built-ins itself:

| Command                   | Pau action                                        |
| ------------------------- | ------------------------------------------------- |
| `/new`                    | New session                                       |
| `/resume`                 | Go to session                                     |
| `/name [name]`            | Rename                                            |
| `/session`                | Session file, ID, message count, tokens, and cost |
| `/tree`                   | Open the Tree tab                                 |
| `/fork`                   | Pick a user message and fork                      |
| `/clone`                  | Clone                                             |
| `/compact [instructions]` | Compact                                           |
| `/model [provider/model]` | Model picker or direct switch                     |
| `/thinking [level]`       | Thinking level                                    |
| `/copy`                   | Copy the last assistant message                   |
| `/export [path]`          | Export (2.121, 2.122)                             |
| `/hotkeys`                | Shortcut list                                     |
| `/settings`               | Settings                                          |
| `/quit`                   | Stop the session after confirmation               |

`/login`, `/logout`, `/share`, `/bug`, `/trust`, `/import`, `/scoped-models`,
`/reload`, and `/changelog` either open vanilla Pi in a Pau terminal or say
which surface handles them. A built-in Pau has not implemented yet appears in
completion as unavailable, with the reason.

### Settings

Settings group choices by intent and show each one's scope:

- Appearance: theme and UI font (user scope)
- Sessions: notification policy and the default delivery mode while running
- Agents: the Pi executable and version Pau found, with a link to Pi's own
  settings file for the default model and thinking level, which Pau shows but
  does not duplicate
- Editor: preferred editor and custom command (2.66, 2.112)
- Terminal: shell environment (2.103)
- Workspace: sandbox default (existing view), permission profile (2.93), and
  later setup and run commands
- Keyboard: the active key map and the location of Pi's `keybindings.json`
- Archived sessions: restore
- Diagnostics: the existing release diagnostics switch

## Gaps for a viable TUI alternative

P0 blocks daily use. P1 is what a Pi user expects. P2 sets Pau apart. "New"
gaps have proposed units in the next section.

| Priority | Gap                                                               | Roadmap                                  |
| -------- | ----------------------------------------------------------------- | ---------------------------------------- |
| P0       | Open a folder from the app and make the product rail navigate     | 2.169 (in progress)                      |
| P0       | Global keyboard map and shortcut list                             | New: 2.NEW-1                             |
| P0       | Working command palette in place of the inert search field        | New: 2.NEW-2                             |
| P0       | Composer keys that match Pi, starting with Enter to send          | New: 2.NEW-3                             |
| P0       | Markdown rendering of assistant messages                          | New: 2.NEW-4                             |
| P0       | Transcript follows streaming output and navigates between prompts | New: 2.NEW-5                             |
| P0       | Pi built-in slash commands such as `/new`, `/fork`, and `/name`   | New: 2.NEW-6                             |
| P0       | Signed build installed for daily use                              | 2.156 (blocked on certificate)           |
| P1       | Tool calls rendered by type, with edit diffs and command output   | New: 2.NEW-7, 2.NEW-8                    |
| P1       | Fork a new session from an earlier prompt                         | New: 2.NEW-9, 2.NEW-10                   |
| P1       | Remove a workspace registration                                   | New: 2.NEW-11, 2.NEW-12                  |
| P1       | Rename and clone                                                  | 2.150                                    |
| P1       | Transcript search                                                 | 2.80, 2.81                               |
| P1       | Copy and export                                                   | 2.121, 2.122                             |
| P1       | Native notification and badge                                     | 2.153                                    |
| P1       | Shell context (`!` commands) in the composer                      | 2.115, 2.116                             |
| P1       | Terminal dock beside the session, reattach, search, activity      | 2.96, 2.57, 2.58, 2.97, 2.99             |
| P1       | Sessions survive reloads and restarts                             | 2.29, 2.59, 2.60, 2.61, 2.107            |
| P1       | Open files and diffs in the preferred editor                      | 2.51, 2.66, 2.110                        |
| P1       | Worktree creation and attachment                                  | 2.27, 2.104, 2.105, 2.106                |
| P1       | Change summary in the session header                              | New: 2.NEW-13                            |
| P1       | Recent saved sessions in the rail                                 | New: 2.NEW-14                            |
| P1       | Unread state and next-attention navigation                        | New: 2.NEW-15                            |
| P1       | Archive stopped sessions                                          | New: 2.NEW-16, 2.NEW-17                  |
| P1       | Settings view for appearance, notifications, and keys             | New: 2.NEW-18, 2.NEW-19                  |
| P1       | Reopen the last view on launch                                    | New: 2.NEW-20                            |
| P1       | Agent readiness on first run                                      | New: 2.NEW-21, 2.NEW-22                  |
| P1       | Permission prompts for operators who opt in                       | 2.45, 2.62, 2.63, 2.64, 2.82, 2.83, 2.93 |
| P2       | Diff line comments sent to the composer                           | New: 2.NEW-23                            |
| P2       | Stage and revert hunks and files                                  | New: 2.NEW-24, 2.NEW-25                  |
| P2       | Workspace setup and run commands in visible terminals             | New: 2.NEW-26, 2.NEW-27                  |
| P2       | Edit the composer draft in an external editor (Ctrl+G)            | New: 2.NEW-28                            |
| P2       | Claude, Codex, and Antigravity sessions in the desktop            | 2.65, 2.123, 2.126                       |
| P2       | Commit, push, PR, and CI tracking                                 | Not proposed; see open questions         |
| P2       | Per-turn file checkpoints                                         | Not proposed; see open questions         |
| P2       | Side-by-side sessions and deep links                              | Not proposed                             |

## Proposed units

These units were filed as tasks in the issue tracker, which now holds their
current scope and the changes made under [Decisions](#decisions). The units
below and the ID mapping under Decisions are a historical record.

The P0 units 2.NEW-1 through 2.NEW-6 and the tool views 2.NEW-7 and 2.NEW-8
block the 2.40 dogfood gate.

### 2.NEW-1 Application keyboard map

Status: planned
Blocked by: 2.169

Add global shortcuts for navigation, session switching, and panel toggles, and
a shortcut list that opens with ⌘/.

Verification:

- Component-test each global shortcut, a shortcut that yields to a conflicting
  Pi binding, and that shortcuts do not fire while a dialog or the terminal has
  focus.
- Drive a self-hosted session from launch to a finished turn without the mouse.

### 2.NEW-2 Command palette

Status: planned
Blocked by: 2.NEW-1

Make the command bar open a palette that searches workspaces, sessions, views,
and session actions and shows each action's shortcut.

Verification:

- Component-test fuzzy matching, disabled actions with their reasons, and an
  empty result.
- Storybook interaction test for opening, filtering, and running an action from
  the keyboard.

### 2.NEW-3 Pi composer keys

Status: planned
Blocked by: none

Match Pi's default composer keys, including Enter to send or steer, Alt+Enter to
queue a follow-up, Alt+Up to restore the queue, Shift+Tab to cycle thinking, and
Ctrl+L to open the model picker.

Verification:

- Component-test each key while idle and while running, and Esc closing a
  completion menu before it interrupts.
- Compare the key list against Pi's keybinding reference and record any
  deliberate difference in the user documentation.

### 2.NEW-4 Markdown transcript messages

Status: planned
Blocked by: none

Render assistant messages as sanitized Markdown with themed, highlighted code
blocks.

Verification:

- Component-test headings, lists, tables, links, inline code, fenced code with
  and without a language, and raw HTML that must not render.
- Storybook stories for a long code block and a streaming partial message in
  each theme.

### 2.NEW-5 Transcript follow and prompt navigation

Status: planned
Blocked by: none

Follow streaming output while the transcript is at the bottom, offer **Jump to
latest** after the operator scrolls up, and move between user prompts with
Ctrl+Shift+Up and Ctrl+Shift+Down.

Verification:

- Component-test following, pausing on scroll, jumping back, and prompt
  navigation with reduced motion on and off.

### 2.NEW-6 Built-in Pi slash commands

Status: planned
Blocked by: 2.NEW-2

Complete and run Pi's built-in slash commands in the composer by mapping each to
its Pau action, and explain the commands that need vanilla Pi.

Verification:

- Component-test completion, arguments for `/name`, `/model`, `/thinking`, and
  `/compact`, and an unavailable command with its reason.
- Run `/new`, `/name`, and `/compact` in a self-hosted session.

### 2.NEW-7 Structured Pi tool events

Status: planned
Blocked by: none

Report tool name, arguments, and result fields for Pi's built-in `bash`,
`read`, `edit`, and `write` tools in session events and history.

Verification:

- Cover each built-in tool, an extension tool that falls back to text, and a
  failed call against the Pi fixture.

### 2.NEW-8 Tool call views

Status: planned
Blocked by: 2.NEW-7

Summarize each tool call on one row and expand it to a diff for edits and
writes, the command output for `bash`, and the path for `read`, with Ctrl+O
toggling all rows.

Verification:

- Component-test each tool type, a running call, a failed call, oversized
  output, and the text fallback.
- Storybook stories for each tool type.

### 2.NEW-9 Pi session fork API

Status: planned
Blocked by: none

Expose Pi's fork messages and fork command through the desktop API so a new
session starts from an earlier user message.

Verification:

- Cover listing fork points, a successful fork, and a fork of a stopped session
  against the Pi fixture.

### 2.NEW-10 Fork from a prompt

Status: planned
Blocked by: 2.NEW-9

Let the operator fork a new session from a user prompt in the transcript or the
Tree tab and open it with that prompt in the composer.

Verification:

- Component-test forking from the transcript, from the tree, and a failed fork.
- Fork a self-hosted Pi session.

### 2.NEW-11 Workspace removal

Status: planned
Blocked by: 2.54

Forget a workspace registration without touching its files, and refuse while it
has live sessions or terminals. Record each removal in the mutation audit.

Verification:

- Cover removal, refusal with a live session, refusal with a live terminal, and
  an unknown workspace.

### 2.NEW-12 Workspace removal view

Status: planned
Blocked by: 2.169, 2.NEW-11

Let the operator remove a workspace from the rail after a confirmation that
states the files stay on disk.

Verification:

- Component-test confirmation, cancellation, and the refusal message with its
  stop action.

### 2.NEW-13 Session change summary

Status: planned
Blocked by: none

Show the workspace's changed-file count and line totals in the session header
and open the inspector's Changes tab from it.

Verification:

- Component-test a clean tree, a dirty tree, a non-Git workspace, and a Git
  status failure.

### 2.NEW-14 Recent saved sessions in the rail

Status: planned
Blocked by: 2.169

List each workspace's most recent saved sessions under its live sessions in the
rail and resume one from there.

Verification:

- Component-test the list, a saved session that is already live, an empty
  history, and a load failure.

### 2.NEW-15 Unread sessions and attention navigation

Status: planned
Blocked by: 2.NEW-1

Mark sessions that finish a turn or fail while out of view as unread, and jump
to the next waiting, failed, or unread session with ⌘⌥A.

Verification:

- Component-test unread marking, clearing on view, clearing all with Shift+Esc,
  and jump order.

### 2.NEW-16 Session archive

Status: planned
Blocked by: none

Store an archived flag for stopped sessions in Pau's database without changing
native session files.

Verification:

- Cover archiving, restoring, refusing a live session, and that native files
  stay unchanged.

### 2.NEW-17 Session archive view

Status: planned
Blocked by: 2.NEW-16, 2.NEW-19

Let the operator archive a stopped session from the rail and restore it from
Settings.

Verification:

- Component-test archive, restore, and the disabled control on a live session.

### 2.NEW-18 UI preferences API

Status: planned
Blocked by: none

Persist theme, UI font, notification policy, and the last workspace and session
route in Pau's database.

Verification:

- Cover reading defaults, saving, an unknown key, and a value from a newer
  version.

### 2.NEW-19 Settings view

Status: planned
Blocked by: 2.169, 2.NEW-18

Add the Settings destination with appearance, session notification, and
keyboard sections that show each setting's scope.

Verification:

- Component-test changing theme and font, notification policy, and a failed
  save.
- Storybook stories at desktop and narrow widths.

### 2.NEW-20 Restore last view on launch

Status: planned
Blocked by: 2.NEW-18

Reopen the last workspace and session route on launch, showing a stopped
session from history with a **Resume** action instead of resuming it.

Verification:

- Component-test a live session, a stopped session, and a removed workspace.

### 2.NEW-21 Agent readiness API

Status: planned
Blocked by: none

Report whether Pau found each supported agent executable, its version, and
whether Pi reports at least one available model.

Verification:

- Cover a found Pi with models, a found Pi without models, a missing
  executable, and an unsupported version against the Pi fixture.

### 2.NEW-22 First-run readiness view

Status: planned
Blocked by: 2.169, 2.NEW-21

Show agent readiness in the empty Sessions view and direct the operator to run
`pi` in a Pau terminal when no provider is configured.

Verification:

- Component-test each readiness state and the terminal action.

### 2.NEW-23 Diff comments to the composer

Status: planned
Blocked by: none

Let the operator comment on diff lines and add those comments to the current
session's composer draft as quoted blocks with path and line.

Verification:

- Component-test adding, editing, and removing comments, and inserting several
  into a draft.

### 2.NEW-24 Hunk stage and revert

Status: planned
Blocked by: 2.54

Stage, unstage, and revert a hunk or file through Git and record each change in
the mutation audit.

Verification:

- Cover each operation, a conflicting hunk, a binary file, and a file that
  changed after the diff was read.

### 2.NEW-25 Hunk stage and revert view

Status: planned
Blocked by: 2.NEW-24

Add stage, unstage, and revert controls to diff review, with confirmation for
revert.

Verification:

- Component-test each control, revert cancellation, and a stale-diff failure.

### 2.NEW-26 Workspace run commands

Status: planned
Blocked by: none

Read named setup and run commands from a checked-in workspace file and start
each one in a new terminal on request. Never run a command automatically.

Verification:

- Cover a valid file, an invalid file, a missing file, and a command that
  exits with an error.

### 2.NEW-27 Run command controls

Status: planned
Blocked by: 2.96, 2.NEW-26

Show a workspace's run commands in the session header and the palette and open
each in the terminal dock.

Verification:

- Component-test running a command, a failed command, and a workspace without
  commands.

### 2.NEW-28 Composer external editor

Status: planned
Blocked by: 2.67

Open the composer draft in the preferred terminal or external editor with Ctrl+G
and put the saved text back in the composer.

Verification:

- Component-test a saved edit, a cancelled edit, and an editor that fails to
  start.

## Decisions

The operator accepted these answers to the earlier open questions:

- Pau reads Pi's `keybindings.json`, and the operator's Pi bindings win when
  they collide with an app shortcut. This replaces the Linux Ctrl+Shift
  fallback.
- Pau honors `.worktreeinclude` only when the operator opts in for that
  workspace.
- New worktrees default to a directory next to the repository named
  `../<repo>-<branch>`.
- Commit, push, and PR creation stay in the terminal before the first release.
- Per-turn Git-ref checkpoints are deferred.
- Archive is a Pau-only flag. Pi's session files stay authoritative, and Pi's
  own picker still lists archived sessions.
- The structured tool events and tool call views join the 2.40 gate.
- Fork needs no new units. The session tree from 2.72 and 2.73 already offers
  **Branch from here**, so 2.NEW-9 and 2.NEW-10 are dropped, and `/fork` opens
  that action.

The proposed units map to these roadmap units:

| Proposed | Roadmap     | Proposed | Roadmap      |
| -------- | ----------- | -------- | ------------ |
| 2.NEW-1  | 2.171       | 2.NEW-15 | 2.205, 2.206 |
| 2.NEW-2  | 2.172       | 2.NEW-16 | 2.208        |
| 2.NEW-3  | 2.184       | 2.NEW-17 | 2.209        |
| 2.NEW-4  | 2.191       | 2.NEW-18 | 2.173        |
| 2.NEW-5  | 2.195–2.197 | 2.NEW-19 | 2.181        |
| 2.NEW-6  | 2.185       | 2.NEW-20 | 2.176        |
| 2.NEW-7  | 2.192       | 2.NEW-21 | 2.182        |
| 2.NEW-8  | 2.193       | 2.NEW-22 | 2.183        |
| 2.NEW-9  | Dropped     | 2.NEW-23 | 2.211        |
| 2.NEW-10 | Dropped     | 2.NEW-24 | 2.212        |
| 2.NEW-11 | 2.178       | 2.NEW-25 | 2.213        |
| 2.NEW-12 | 2.179       | 2.NEW-26 | 2.215        |
| 2.NEW-13 | 2.207       | 2.NEW-27 | 2.216        |
| 2.NEW-14 | 2.180       | 2.NEW-28 | 2.189        |

2.NEW-5 merged with the motion note's follow mode and **Jump to latest** units,
and 2.NEW-15 merged with its session attention markers. Reading Pi's
`keybindings.json` became its own backend unit, 2.170.
