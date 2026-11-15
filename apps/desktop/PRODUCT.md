# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A developer who runs several coding agents at once on one machine. Pi and
Claude Code sessions run side by side across workspaces and Git worktrees. The
developer starts and steers sessions, notices which one needs them, reviews what
changed, and drops into files and terminals. Pau replaces the Pi terminal UI for
that daily work. The maintainer is the first user.

## Product Purpose

Pau is an IDE and session orchestrator for coding agents. It brings concurrent
agent sessions, files, review, editing and terminals into one workspace. Success
means a developer can keep many sessions moving without losing track of any of
them, and never has to leave Pau to see what an agent did.

## Positioning

Nothing is hidden. Pau orchestrates the real processes, files, terminals and the
agent's own session files instead of wrapping them in an abstraction. Many
sessions at once is the normal case: the interface is built around which session
is running, waiting on the developer, failed or done.

## Operating Context

- A workspace is a local directory or Git worktree, and owns its terminals,
  editor state and agent sessions. One repository can have several active
  workspaces.
- An agent session is a long-lived process with a native persisted
  conversation. Statuses: starting, idle, running, waiting, stopping, stopped,
  failed, and not responding.
- Adapters report capabilities. Unsupported controls are hidden or disabled
  with an explanation.
- Resources (skills, Pi extensions and packages, prompt templates, MCP servers)
  have an explicit scope: user, workspace or project. Pau shows the file or
  command it will change before applying an update.
- Workspaces can run sessions and terminals inside an OS sandbox, and Pau keeps
  an audit log of the processes, files and settings it changes.
- Used for long stretches at a desk, keyboard first, often beside other
  terminals and editors.

## Capabilities and Constraints

- Desktop app built with Tauri. The UI renders in the system webview: WebKit on
  macOS and Linux. A later web app serves the same UI from a Pau server.
- Shared UI lives in `packages/ui` and must not import Tauri APIs.
- Pi is the reference agent. Claude Code is supported through a bridge, and
  other agents join through adapters.
- Dark themes only. The shipped themes are Eldritch (the lead palette), Nord,
  Iceberg, Catppuccin Mocha and Vitesse Dark, with upstream attribution.
- Windows from 900px wide up to large desktop displays.

## Brand Commitments

- The name is Pau.
- The Eldritch palette leads, using eldritch.nvim's colors.
- `dev/design` in the repository records the design decisions and wins over
  any visual reference.

## Evidence on Hand

- The running desktop app and its Storybook stories in `packages/ui`.
- The design audit of the current app, with 24 findings and 135 screenshots,
  is a Linear document on the redesign issue.
- There are no testimonials, customers or benchmarks. Don't invent them.

## Product Principles

1. Show the real thing. Processes, files and session state stay visible and
   controllable, never summarized away.
2. Attention is the product. The developer should see at a glance which session
   needs them.
3. Hide or explain what an agent can't do. Never show a control that silently
   does nothing.
4. Keyboard first, mouse complete.
5. Change nothing without saying what will change.

## Accessibility & Inclusion

WCAG 2.2 AA: text at 4.5:1, and borders, focus rings and other non-text
indicators at 3:1. Full keyboard operation with visible focus.
