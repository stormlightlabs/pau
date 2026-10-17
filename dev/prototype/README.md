# Pau prototype

The prototype is an OpenPencil design file, `pau.fig`, and the PNG exports in
this directory. Use it to settle layout, states, and product language before a
design moves into `packages/ui` or an application. Its screens may show ideas
the product does not implement yet. [`SPEC.md`](../SPEC.md) and
[`PLAN.md`](../PLAN.md) remain the source of truth.

[`dev/design`](../design/README.md) records the decisions the file draws.
[`system.md`](../design/system.md) owns the visual system, and
[`surfaces.md`](../design/surfaces.md) maps each page and frame to its purpose
and responsive contract. Update a frame, its PNG, and the owning design document
together when a durable decision changes.

## Design file

`pau.fig` is not stored in this repository yet. The maintainer keeps the working
copy in OpenPencil. Open it with the OpenPencil desktop app or inspect it with
the `openpencil` CLI.

The file has these pages:

- Foundations holds the token reference table.
- Components holds the reusable pieces: the workbench sidebar and page header,
  the application top bar and product rail, buttons, chips, fields, tabs,
  section labels, the Pau mark, and agent marks.
- One page per screen, named after the screen's former route: `index`, `docs`,
  `splash/launch`, `splash/reconnect`, and `screens/<name>` for each product
  screen.

Each top-level frame on a screen page is one state at 1440 × 1000, named
`<page> — <state>`. Only the sandbox page has a taller frame, which shows the
whole sandboxed form.

### Tokens

Colors, type sizes, spacing, radii, and layout sizes are variables in three
collections:

- Theme has one mode per shipped theme: Eldritch (default), Nord, Iceberg,
  Catppuccin Mocha, and Vitesse Dark.
- Site has Light and Dark modes for the public website and documentation.
- Scale holds spacing, type, radius, border, row, and rail sizes.

Every screen frame uses the Eldritch theme. The editor screen originally showed
Catppuccin Mocha, the terminal screen Nord, and the settings screen Iceberg;
switch a frame's Theme mode to review another palette.

## Exported images

Each PNG is one frame exported at 1x and named after its page and state, with
slashes replaced by hyphens, such as `screens-session-focused.png`.
`foundations-tokens.png` exports the token table.

To regenerate an image, open `pau.fig` in OpenPencil, select the frame, and
export it as PNG at 1x. From a terminal, the CLI exports one frame by node ID:

```sh
openpencil export pau.fig --node <frame-id> -o dev/prototype/<page>-<state>.png
```

Reduce each new PNG to a 128-color palette before committing it:

```sh
magick mogrify -strip -dither None -colors 128 -define png:format=png8 \
  dev/prototype/<page>-<state>.png
```

## Add a screen or state

1. Add a page for a new screen, or a frame for a new state, in `pau.fig`.
2. Build it from the shared components and bind colors and sizes to variables.
3. Export the frame to this directory.
4. Add or update the screen's brief in `dev/design/surfaces.md`.

Use real product terms and representative states. Do not invent capabilities,
customer data, or performance claims to fill a mockup.
