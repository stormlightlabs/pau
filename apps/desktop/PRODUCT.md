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
