# Design references

This directory records Pau's durable interface decisions and early sketches.
Product behavior remains defined by [`SPEC.md`](../SPEC.md), and architecture
and implementation policy remain defined by [`PLAN.md`](../PLAN.md).

- [`system.md`](system.md) defines the visual and interaction system.
- [`surfaces.md`](surfaces.md) maps each product surface to its prototype route
  and states its purpose, hierarchy, and responsive behavior.
- [`icons.md`](icons.md) assigns icon families by role.
- The PNG files are early sketches, not implementation commitments.

`packages/prototype` is the executable companion to these documents. Update the
owning brief and prototype fixture together when a durable design decision
changes. A screenshot-only adjustment does not need a prose change unless it
changes the recorded system or surface contract.

## Settled direction

The settled direction now lives in [`system.md`](system.md). Keep this index
focused on document ownership and sketch provenance.

## What the sketches explore

### Workspace and session

[`ws-eldritch.png`](ws-eldritch.png) explores the main operating layout: a
product rail, workspace and session rail, central conversation, and inspector.
It also shows session attention states, tool activity, checks, a plan, and the
composer in one view.

### Settings

[`ib-settings.png`](ib-settings.png) explores theme previews, agent discovery,
and separate controls for applying the Pau theme to Neovim and loading the
user's `init.lua`.

### Resources and MCP

[`nord-integrations.png`](nord-integrations.png) explores a resource browser with
MCP servers, skills, and prompts. The selected item opens in an inspector with
scope, connection state, configuration, tools, agent access, and test controls.

### Editor and review

[`nvim-catp.png`](nvim-catp.png) explores a workspace file tree, editor tabs, an
embedded Neovim surface, and a review inspector with changed files and hunks.

The sketches may contain placeholder names, controls, icons, copy, and states.
Do not infer a requirement from an image when the specification or plan does not
support it.
