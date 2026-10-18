# Pau prototype

The prototype is an OpenPencil design file, `pau.fig`, and a set of static HTML
pages in this directory that rebuild each of its screens. Use them to settle
layout, states, and product language before a design moves into `packages/ui`
or an application. The screens may show ideas the product does not implement
yet. [`SPEC.md`](../SPEC.md) and [`PLAN.md`](../PLAN.md) remain the source of
truth.

[`dev/design`](../design/README.md) records the decisions the file draws.
[`system.md`](../design/system.md) owns the visual system, and
[`surfaces.md`](../design/surfaces.md) maps each page and frame to its purpose
and responsive contract. Update a frame, its HTML page, and the owning design
document together when a durable decision changes.

## View the screens

Open [`index.html`](index.html) in a browser. It links every screen and state
and has a theme menu. The chosen theme is saved in the browser and passed to
each linked page as a `?theme=` query, so `screens-editor-default.html?theme=nord`
also works on its own. The themes are `eldritch` (default), `nord`, `iceberg`,
`catppuccin-mocha`, and `vitesse-dark`.

The pages load Overpass and Overpass Mono from Google Fonts. The documentation
pages also load IBM Plex Sans for body copy. Offline, the pages fall back to
locally installed copies and then to system fonts. No build step or server is
needed.

Each page shows only the product: the application window for product screens,
and the page content for the public site and the launch and reconnect states.
The launch pages show the step list the app's launch view renders, including a
step that needs attention and a failed start, instead of a progress bar.
Pages lay out for a 1440 × 1000 window and recompose at narrower widths: the
inspector leaves first, then the context rail.

## Files

- `<page>-<state>.html` is one frame, named after its page and state with
  slashes replaced by hyphens, such as `screens-session-focused.html`.
- `foundations-tokens.html` lists every token value.
- `styles/tokens.css` holds the design tokens. Theme colors are one
  `[data-theme]` block per theme, the public site palette has light and dark
  blocks, and scale tokens sit on `:root`.
- `styles/app.css` holds the shell, shared controls, and one section per
  surface.
- `styles/icons.css` holds one class per icon as an SVG data URI.

Pages use semantic HTML and the shared classes. Keep page-specific inline
styles to one-off sizes that the frame records.

## Design file

`pau.fig` is not stored in this repository yet. The maintainer keeps the working
copy in OpenPencil. Open it with the OpenPencil desktop app or inspect it with
the `openpencil` CLI.

The file has these pages:

- Foundations holds the token reference table.
- Brand holds the README banner, exported to `.github/assets/banner.png`.
- Components holds the reusable pieces: the application top bar and product
  rail, buttons, chips, fields, tabs, section labels, the Pau mark, and agent
  marks. It also still holds the old workbench sidebar, page header, and hub
  card that the `index` page uses.
- One page per screen, named after the screen's former route: `index`, `docs`,
  `splash/launch`, `splash/reconnect`, and `screens/<name>` for each product
  screen.

Each top-level frame on a screen page is one state, named `<page> — <state>`,
and holds only the application window or the site page.

### Tokens

Colors, type sizes, spacing, radii, and layout sizes are variables in three
collections:

- Theme has one mode per shipped theme: Eldritch (default), Nord, Iceberg,
  Catppuccin Mocha, and Vitesse Dark.
- Site has Light and Dark modes for the public website and documentation.
- Scale holds spacing, type, radius, border, row, and rail sizes.

Every screen frame uses the Eldritch theme. Switch a frame's Theme mode in
OpenPencil, or the theme menu on the index page, to review another palette.

## Keep the pages in sync

When a frame changes in `pau.fig`, edit its HTML page to match. Read the frame's
structure and copy with the OpenPencil MCP tools or `openpencil export --format
jsx`, which keep text exact, rather than from an exported image. OpenPencil
0.15 renders IBM Plex Sans with the wrong glyphs, so its PNG exports are not a
reliable reference.

`styles/tokens.css` mirrors the Theme, Site, and Scale variables and uses the
custom property names in `packages/ui`. Where a shipped theme in
`packages/ui/src/theme.ts` has raised a color for contrast, the stylesheet uses
the shipped value. Update `tokens.css`, `foundations-tokens.html`, and the
variables together when a token changes.

Icons follow [`icons.md`](../design/icons.md). To add one, copy its SVG from
Iconify, add an `.i-<set>-<name>` rule to `styles/icons.css` with the SVG as a
data URI, and use it as `<span class="icon i-<set>-<name>" aria-hidden="true">`.
Add `icon--color` for multicolor marks such as Catppuccin file icons and
product logos.

## Add a screen or state

1. Add a page for a new screen, or a frame for a new state, in `pau.fig`.
2. Build it from the shared components and bind colors and sizes to variables.
3. Add its HTML page here, reusing the shell and classes from a neighboring
   page, and link it from `index.html`.
4. Add or update the screen's brief in `dev/design/surfaces.md`.

Use real product terms and representative states. Do not invent capabilities,
customer data, or performance claims to fill a mockup.
