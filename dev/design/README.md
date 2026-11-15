# Design references

This directory records Pau's durable interface decisions and early sketches.
The Product specification and the Technical plan, which live in the project's issue
tracker, define product behavior and implementation policy.

- [`system.md`](system.md) defines the visual and interaction system.
- [`surfaces.md`](surfaces.md) states each product surface's purpose,
  hierarchy, and responsive behavior.
- [`icons.md`](icons.md) assigns icon families by role.
- The PNG files in this directory are early sketches, not implementation
  commitments.

Update the owning document when a durable design decision changes. A
visual-only adjustment does not need a prose change unless it changes the
recorded system or surface contract.

## Settled direction

The settled direction is the Strip Bay, recorded in [`system.md`](system.md).
[`apps/desktop/DESIGN.md`](../../apps/desktop/DESIGN.md) lists its token
values, and `apps/desktop/.impeccable/wireframes/` holds a static wireframe of
each desktop surface. Open a wireframe's HTML file in a browser to see it.
Where these disagree with this directory, this directory wins.

## What the sketches explore

### Workspace and session

[`ws-eldritch.png`](ws-eldritch.png) explored an earlier operating layout: a
product rail, workspace and session rail, central conversation, and inspector.
The Strip Bay replaced it.
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
