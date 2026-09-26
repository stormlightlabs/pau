# Changelog

## 2026-09-23

### Claude bridge package

- Added `@stormlightlabs/pau-claude-bridge` for running Claude Code from Pi.

### Desktop and web

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
- Pau now remembers registered workspaces and settings between launches.
- Protected local connections with a per-launch token and kept secrets out of
  diagnostic logs.
- Added the Pau documentation site.
