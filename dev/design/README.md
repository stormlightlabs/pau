# Design references

The images in this directory are sketches, not implementation commitments. Use
them to discuss layout, density, hierarchy, and interaction patterns. Product
behavior remains defined by [`SPEC.md`](../SPEC.md), and the current design
direction remains defined by [`PLAN.md`](../PLAN.md#design-direction).

## Settled direction

- Ship Eldritch, Nord, Iceberg, Catppuccin Mocha, and Vitesse Dark.
- Prefer square corners. Use low-radius rounding only where it helps identify a
  control or state.
- Use Svelte's motion, transition, and animation APIs. Every motion treatment
  must respect the reduced-motion setting.
- Keep the interface dense and flat. Separate regions with alignment, spacing,
  and restrained borders instead of nested cards.

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
