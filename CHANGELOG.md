# Changelog

## 2026-10-17

### Desktop

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
