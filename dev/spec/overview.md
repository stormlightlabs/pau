# Product overview

## Purpose

Pau is a local IDE and session orchestrator for developers who use Pi and other
coding agents. It brings concurrent sessions, files, review, editing, and
terminal tools into one workspace without hiding the underlying processes or
files.

Pi is the reference implementation. Other agents are supported where their CLIs
expose enough control to provide a reliable adapter.

## Core concepts

### Workspace

A local directory or Git worktree. A workspace owns terminals, editor state, and
agent sessions. The app must not assume that one repository has only one active
workspace.

### Agent session

A long-lived process and its native persisted conversation. A session has an
adapter, workspace, status, capabilities, and ordered event stream. The agent's
own files remain the source of truth for conversation history.

Statuses are `starting`, `idle`, `running`, `waiting`, `stopping`,
`stopped`, and `failed`.

### Adapter

An implementation for one agent protocol. Every adapter reports capabilities
rather than relying on product-wide assumptions. Initial capabilities include:

- start, resume, stop, and interrupt
- prompt, steer, and follow up
- streamed text and structured tool events
- model and thinking-level selection
- session branching or forking
- permission requests
- resource discovery and reload

Unsupported controls are hidden or disabled with an explanation.

### Resource

A skill, Pi extension or package, prompt template, MCP server configuration, or
agent-specific plugin. Scope is explicit: user, workspace, or project. The app
shows the file or command it will change before applying an update.
