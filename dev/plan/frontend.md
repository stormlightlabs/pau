# Frontend and design

## Frontend

Use SvelteKit in static SPA mode for both product applications. `packages/ui`
owns reusable components and feature-level views, with no knowledge of SvelteKit
routing, Tauri, or remote authentication. `apps/desktop` owns the local route
tree, loopback API client, event stream, and native capability adapters. Its
static assets ship with Tauri.

`apps/web` is the later remote browser application. It owns remote
authentication, server connection and recovery, and route-level capability
gating. Reuse shared feature views where behavior matches, but do not import the
desktop route tree or expose a desktop-only control that the server cannot
perform.

Keep shared server state in feature stores fed by snapshot and event reducers.
Each application owns the stores for state that differs by transport or host.
Desktop routes should be deep-linkable:

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

Resource use remains visible outside diagnostics mode. Show a compact summary in
the session inspector and provide a workspace Processes view for process trees,
current and peak measurements, history, warnings, and explicit interrupt or stop
actions.

Diagnostics mode adds a dedicated view for versions, capabilities, transport and
replay state, process lifecycle, bounded redacted logs and traces, and diagnostic
export. Keep these details out of normal task surfaces unless they explain a
current failure. Mark diagnostics mode visibly while it is enabled. Put
fault-injection controls in a separate development-only panel. The desktop view
reports the local app and loopback backend. The web view reports the browser,
remote connection, and server without claiming access to desktop-native state.

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
colors, the terminal's ANSI palette, and CodeMirror highlighting. Source the
palettes from their upstream projects and retain required licenses and
attribution. Pau does not apply its theme to external or terminal editors.

The wide layout has a persistent product rail, a contextual workspace or section
rail, one main task surface, and an optional right inspector. The command bar
stays globally available. The main surface switches among conversation, editor,
terminal, and resource views; the inspector holds review, plan, checks,
permissions, or selected-resource detail. The terminal bottom dock is the only
surface that may share the main column vertically.

Bundle the application UI fonts and let the operator choose between IBM Plex
Sans Variable, Inter Variable, Atkinson Hyperlegible Next Variable, and
Atkinson Hyperlegible Soft. Use Fontsource variable packages for the first
three. Vendor Atkinson Hyperlegible Soft from its upstream repository with its
license and attribution. Set code in IBM Plex Mono from its Fontsource
package. The documentation site uses IBM Plex Sans Variable for
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
the inspector to an overlay or full view, and let editor and terminal surfaces
use all available space. Do not shrink the three-column desktop
composition until its text and controls no longer fit.
