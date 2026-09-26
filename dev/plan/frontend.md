# Frontend and design

## Frontend

Use SvelteKit in static SPA mode. `packages/ui` owns reusable components and
feature-level views, with no knowledge of SvelteKit routing or Tauri. `apps/web`
composes those views into routes, wires the API client and event stream, and
produces the static assets consumed by both Axum and Tauri.

Keep server state in shared feature stores fed by snapshot and event reducers.
Routes should be deep-linkable:

```text
/workspaces/:workspaceId/sessions/:sessionId
/workspaces/:workspaceId/editor
/workspaces/:workspaceId/resources
/settings
```

The main operating view uses a workspace/session rail, one central task surface,
and an optional inspector for tool calls, diffs, and permissions. Avoid a
dashboard-first design; opening the app should return the operator to active
work.

## Design direction

The references in `dev/design/` guide the whole application rather than isolated
screens. This is an operating interface: dense, dark by default, flat, and
divided by alignment and restrained borders rather than nested cards. Keep
corners square or use only subtle rounding. Use Svelte's motion, transition, and
animation APIs for interface motion, and honor the reduced-motion setting. Theme
support is structural, so palette values become semantic tokens rather than
component-local values.

The first release ships Eldritch, Nord, Iceberg, Catppuccin Mocha, and Vitesse
Dark. Each theme defines application surfaces and text, semantic states, syntax
colors, the terminal's ANSI palette, CodeMirror highlighting, and Neovim
highlight mappings. Source the palettes from their upstream projects and retain
required licenses and attribution. The optional “Apply theme to Neovim” setting
changes highlights only after explicit opt-in; loading the user's `init.lua` and
overriding its colors remain separate choices.

The wide layout has a persistent product rail, a contextual workspace or section
rail, one main task surface, and an optional right inspector. The command bar
stays globally available. The main surface switches among conversation, editor,
Neovim, terminal, and resource views; the inspector holds review, plan, checks,
permissions, or selected-resource detail. The terminal bottom dock is the only
surface that may share the main column vertically.

Bundle the application UI fonts and let the operator choose between IBM Plex
Sans Variable, Inter Variable, Atkinson Hyperlegible Next Variable, and
Atkinson Hyperlegible Soft. Use Fontsource variable packages for the first
three. Vendor Atkinson Hyperlegible Soft from its upstream repository with its
license and attribution. The documentation site uses IBM Plex Sans Variable for
body copy, Google Sans Variable for headings, and Google Sans Code Variable for
code. Self-host every
font file; do not fetch fonts at runtime. Preserve the compact
rhythm in the application mockups while keeping interactive targets large
enough through invisible padding and keyboard access.

Follow `dev/design/icons.md`: Tabler for general interface actions, Octicons
for Git, Catppuccin for file types, and Simple Icons for named services. Load
icons through UnoCSS's icon preset or an equivalent build-time Iconify
integration. Every icon-only control needs an accessible name, and state must
not rely on icon shape or color alone.

At narrower widths, collapse the contextual rail before the product rail, move
the inspector to an overlay or full view, and let editor, Neovim, and terminal
surfaces use all available space. Do not shrink the three-column desktop
composition until its text and controls no longer fit.
