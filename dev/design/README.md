# Design references

This directory records Pau's durable interface decisions and early sketches.
Product behavior remains defined by [`SPEC.md`](../SPEC.md), and architecture
and implementation policy remain defined by [`PLAN.md`](../PLAN.md).

- [`system.md`](system.md) defines the visual and interaction system.
- [`surfaces.md`](surfaces.md) maps each product surface to its prototype page
  and states its purpose, hierarchy, and responsive behavior.
- [`icons.md`](icons.md) assigns icon families by role.
- The PNG files in this directory are early sketches, not implementation
  commitments.

The OpenPencil design file `pau.fig` and the HTML screens in
[`dev/prototype`](../prototype/README.md) draw these decisions. Update the owning
brief, the affected frames, and their HTML pages together when a durable design
decision changes. A visual-only adjustment does not need a prose change unless
it changes the recorded system or surface contract.

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

[`ib-settings.png`](ib-settings.png) explored theme previews, agent discovery,
and embedded Neovim settings. The current direction keeps editor configuration
separate from Pau themes and uses a preferred-editor launcher.

### Resources and MCP

[`nord-integrations.png`](nord-integrations.png) explores a resource browser with
MCP servers, skills, and prompts. The selected item opens in an inspector with
scope, connection state, configuration, tools, agent access, and test controls.

### Editor and review

[`nvim-catp.png`](nvim-catp.png) explored a workspace file tree, editor tabs, an
embedded Neovim surface, and a review inspector. Deep editor embedding is now a
later research item rather than a first-release requirement.

The sketches may contain placeholder names, controls, icons, copy, and states.
Do not infer a requirement from an image when the specification or plan does not
support it.
