# Changelog

## 2026-10-18

### Desktop

- Pau opens its window right away while it starts, and still opens when Pi is
  missing.
- On Linux, Ctrl+K opens the command palette outside text fields and still
  deletes to the end of the line while you type. The shortcut list shows where
  each Pi binding takes a key.
- The session sidebar keeps each workspace's name and its new-session and
  saved-sessions buttons on one row, empty screens sit at the top of the
  window, and the app no longer shows "Connected" while the connection is
  fine.
- The file tree lists folders first in natural order, and the editor fills its
  pane, aligns its header, and highlights Markdown.
- Pau opened from Finder, the Dock, or Spotlight now finds Pi and other tools
  on your login shell's PATH.
- Pau uses Overpass by default and Overpass Mono for code and the terminal,
  with larger 14px body text. IBM Plex Sans remains available.
- Type / in the composer to run Pi's built-in commands, such as /name, /model,
  /thinking, /compact, /new, and /fork. Commands that need Pi's terminal show
  why they are unavailable.
- Dropdowns match Pau's design, show readable names such as "Extra high" for
  thinking levels, and work fully from the keyboard.
- Press ⌘K, or F1 on Linux, or click the search field to open a command palette
  that finds actions, sessions, workspaces, and views and shows each action's
  shortcut.
- Ctrl+Shift+Up and Ctrl+Shift+Down move between your prompts in the transcript.
- The composer uses Pi's keys and your Pi keybindings.json: Enter sends or
  steers, Shift+Enter adds a line, Alt+Enter queues a follow-up, Alt+Up restores
  the queue, Shift+Tab changes the thinking level, and Ctrl+L opens the model
  picker.
- Closing a dialog, menu, or side panel returns focus to the control that opened
  it, or to the prompt when that control is gone.
- Right-click a session, workspace, file, or message, or press Shift+F10, to
  rename, clone, stop, branch, copy paths or text, open a terminal, or reveal
  items in Finder. Session names now persist across reloads.
- Finished tool and thinking blocks collapse when the turn ends instead of
  mid-turn. Blocks you open or close stay that way, and the transcript no longer
  jumps when a block above your reading position changes size.
- Focus rings look the same on every control and are no longer cut off inside
  scrolling panels.
- Added keyboard shortcuts for sessions, panels, navigation, and page zoom, a
  shortcut list on ⌘/, and New Session and Open Workspace in the app menu. Your
  Pi key bindings take precedence when they collide.
- Returning to a session puts the transcript back where you left it, or at the
  latest output if you were following it.
- Sent prompts appear in the transcript right away. A prompt that fails to send
  is marked "Not sent" and its text returns to the composer.
- The session list marks sessions that are waiting for you, failed, or finished
  while you were elsewhere, until you open them or press Shift+Esc.
- Each session state now has its own mark in the session list and header, and
  the running spinner holds still when reduced motion is on.
- Copy any message, code block, or tool output from the transcript with one
  click. A confirmation shows when the copy works, and a clear message shows
  when the clipboard is unavailable.
- Added a Motion setting (System, Reduce, Full) on the Diagnostics page that
  overrides the system reduced-motion preference and syncs across windows.
- Screen readers hear when a response starts and finishes, when a tool call
  fails, and when Pi needs your input, instead of every streamed update.
- Type @ in the prompt to pick a workspace file or folder and insert its path,
  as in Pi.
- A Jump to latest button (or Ctrl+End) appears when new output arrives while
  you are scrolled up in a session.
- Drag the edge of the sidebar or inspector to resize it, or use the arrow keys,
  and double-click to reset. Pau remembers the widths between launches.
- Press Cmd+F (Ctrl+F on Linux) in a session to search the conversation and jump
  to any matching message.
- The transcript stays at the newest output while you are at the bottom and
  stops following when you scroll up.
- Tool calls in the transcript show bash commands with their output, exit code,
  and duration, read ranges, edit diffs, and write previews. Press Ctrl+O to
  expand or collapse all of them.
- Assistant messages render as Markdown, with headings, lists, tables, links,
  and code blocks in the code font.
- Streaming replies render more smoothly because transcript updates are applied
  once per frame.

## 2026-10-17

### Desktop

- Open a project folder from the sessions rail or the first-run screen, and use
  the product rail to move between sessions, files, terminal, agent sandbox,
  and diagnostics. Views that are not ready yet show as coming soon.
- The desktop app no longer puts its local API token in the window URL, and
  moving between pages keeps the backend connection.
- Fixed the installed app opening to a "404 Not Found" page.
- The app icon now follows the macOS icon shape instead of sitting on a plate.
- `scripts/install.sh` builds a release tag on your Mac and installs it,
  prompting for the version or taking it as an argument.
- Resumed, branched, and reloaded sessions show their full conversation from
  Pi, including a summary of compacted turns.
- Attach images to a prompt by pasting, dragging them onto the composer, or
  using the Attach image button.
- The session header shows how much of the model's context window a session
  uses, with a warning near the limit and token and cost details on click.
- Compact a session's context from the session header, with optional
  instructions, and see manual and automatic compactions as expandable markers
  in the transcript.
- The thinking-level control shows the level Pi is using, and opening a saved
  session that is already running selects it instead of resuming it again.
- Browse a session's tree in the inspector and branch from an earlier prompt.
  Pau puts that prompt back in the composer so you can edit and resend it.
- Type `/` in the composer to browse and complete Pi's extension commands,
  prompt templates, and skills.
- Queued steering and follow-up messages appear above the composer, and
  "Clear queue" puts them back in the composer for editing.
- Choose how hard the model thinks from the session header, with levels from
  off to max.
- Retry a failed turn from the session view, and see or cancel Pi's automatic
  retries while they count down.
- Switch a Pi session's model from the session header. The picker is
  disabled while a run is in progress.
- Press Up and Down in the prompt box to recall earlier prompts from the
  session, then return to what you were typing.
- Live Pi sessions now show extension dialogs, notifications, status text, and
  widgets. Answer dialogs in the session view. They close with an explanation
  when they expire or the session ends.
- Browse a workspace's saved Pi sessions and resume one from the session
  picker.
- Pau is now tested with Pi 1.0. The permission extension runs MCP tools that
  declare themselves read-only and closed-world without asking.
- Text across the app is now at least 12px with consistent spacing and corner
  rounding. Code uses IBM Plex Mono, and IBM Plex Sans is the default interface
  font.
- Pau now shows a dialog explaining why it could not start, such as a
  database from a newer version, instead of quitting silently.
- Workspaces now have shell terminals in tabs, with copy and paste, resizing,
  exit status, and the active theme's colors.
- The session view now shows live Pi sessions. Start a session in a workspace,
  follow its streaming transcript, prompt, steer, queue follow-ups, interrupt,
  and stop.
- The local API can list a workspace's saved Pi sessions and resume one.
- The local API can open workspace terminals with live input, output, resize,
  signals, and close.
- Development builds now report a `-dev` version with the commit, install as
  "Pau Dev", and keep their data separate from the released app.
- Pau now refuses to open a database created by a newer version and names the
  version that created it.

## 2026-10-01

### Claude bridge package

- Fixed packaged bridge startup when its executable path contains a symbolic
  link.

### Desktop

- Effective sandbox profiles now list the destinations for each brokered
  credential and warn that those destinations can use or return it.
- Sandbox credential references can now protect URL passwords and
  colon-separated credentials while preserving the surrounding value.
- Brokered AWS credentials now support destination-scoped SigV4 re-signing.
- Brokered credential sentinels are now replaced in HTTPS request headers and
  bodies only for each credential's configured hosts and ports.
- Sandboxed tools now receive a unique credential sentinel for each session,
  while real values stay in a dedicated broker process and are cleared when the
  session ends.
- Sandbox profiles can now save tool credential references and their configured
  destinations without storing credential values.
- Sandboxed macOS tools now report blocked file and direct TCP attempts from
  tool-host processes and their descendants.
- Sandboxed Linux tools now report blocked file and connection attempts from
  dynamically linked processes and their descendants.
- Session transcripts now show file and network access blocked by the active
  sandbox, including failures whose blocked access Pau cannot identify.

## 2026-09-28

### Desktop

- Sandboxed Pi tools now tell the agent which path the sandbox blocked when a
  call fails.

## 2026-09-27

### Desktop

- Added an optional local sandbox for agent tools.

## 2026-09-26

### Desktop

- Added process resource monitoring.
- Added redacted release diagnostics.

## 2026-09-23

### Claude bridge package

- Added `@stormlightlabs/pau-claude-bridge` for running Claude Code from Pi.

### Desktop and web

- The desktop application now owns its routes, local API connection, event
  stream, browser development mode, and Tauri assets. The remote web application
  remains separate.
- Added the first desktop and browser interface with responsive navigation, a
  command bar, and an inspector.
- Added concurrent Pi and Claude sessions with streamed transcripts, tool
  activity, and clear status and attention states.
- Pi sessions now support follow-ups, steering, interruption, model selection,
  and recovery after a reload or connection loss.
- Pi sessions now show extension dialogs, notifications, status text, and string
  widgets. Terminal-only components direct the operator to vanilla Pi.
- Added native MCP configuration and lifecycle management for Pi and Claude,
  including source and scope, targeted edits, explicit enablement,
  authentication, connection tests, diagnostics, and lazy startup.
- Pau now finds local Pi installations and reports setup problems before a
  session starts.
- Added five themes and four bundled interface fonts.
- Added workspace file browsing and search, including hidden and ignored file
  controls and changed-file Git status.
- Added CodeMirror editing with safe saves, external-change detection, explicit
  unsupported-file states, and file and hunk diff review.
- Pau now remembers registered workspaces and settings between launches.
- Protected local connections with a per-launch token and kept secrets out of
  diagnostic logs.
- Added the Pau documentation site.
