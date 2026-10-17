# Changelog

## 2026-10-17

### Desktop

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
