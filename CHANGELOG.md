# Changelog

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
