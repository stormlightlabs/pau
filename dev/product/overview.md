# Overview

## Purpose

Pau is an IDE and session orchestrator for developers who use Pi and other
coding agents. The desktop app works on its local machine. The later web app
works on the machine that runs the configured Pau server, whether the operator
opens it locally or through an authenticated private connection. Both bring
concurrent sessions, files, review, editing and terminals into one workspace
without hiding the underlying processes or files.

Pi is the reference implementation. Pau supports other agents where their CLIs
expose enough control for a reliable adapter.

## Core concepts

### Workspace

A local directory or Git worktree. A workspace owns terminals, editor state and
agent sessions. The app must not assume that one repository has only one active
workspace.

### Agent session

A long-lived process and its native persisted conversation. A session has an
adapter, a workspace, a status, capabilities and an ordered event stream. The
agent's own files remain the source of truth for conversation history.

The statuses are `starting`, `idle`, `running`, `waiting`, `stopping`,
`stopped` and `failed`.

### Adapter

The implementation of one agent protocol. Each adapter reports its
capabilities instead of relying on product-wide assumptions. The initial
capabilities are:

- start, resume, stop and interrupt
- prompt, steer and follow up
- streamed text and structured tool events
- model and thinking-level selection
- session branching or forking
- permission requests
- resource discovery and reload

Pau hides an unsupported control, or disables it with an explanation.

### Resource

A skill, Pi extension or package, prompt template, MCP server configuration or
agent-specific plugin. Its scope is explicit: user, workspace or project. Before
applying an update, the app shows the file or command it will change.
