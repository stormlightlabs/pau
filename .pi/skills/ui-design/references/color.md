# Color

Use color for hierarchy, meaning, and atmosphere. Build roles, not a collection
of swatches.

## Define semantic roles

At minimum, consider:

- canvas, surface, raised surface, selected surface;
- primary, secondary, and disabled text;
- borders and strong separators;
- action, focus, and selection;
- success, warning, danger, and information;
- diff, syntax, terminal, chart, or domain roles when the product needs them.

Keep primitive palette values separate from semantic roles. Theme changes should
normally remap roles instead of changing component code.

## Choose dosage

Name the palette's temperature, dominant relationship, contrast range, and
color dosage. A restrained operating interface usually spends its strongest
accent on the primary action, current selection, focus, and meaningful state.
Rarity gives the accent force.

A persuasive or experiential surface may let color own a large region when the
visual direction calls for it. Avoid scattering saturated accents without a
hierarchy.

## Compose themes

- Design dark mode rather than mechanically inverting light mode.
- Use distinct surface values to express elevation and grouping.
- Tint neutrals only when a brand hue creates useful cohesion. Neutral gray is
  valid.
- On a colored surface, derive secondary text from the foreground/surface
  relationship instead of defaulting to generic gray.
- Keep semantic meanings stable across themes while respecting domain and
  platform conventions.
- Prefer explicit colors when layered alpha would make contrast dependent on an
  unknown background.

OKLCH is useful for new web palettes because lightness and chroma can be tuned
predictably. Reduce chroma near very light and very dark endpoints.

## Contrast and non-color cues

Check computed pairs, not appearance alone:

- normal text: at least 4.5:1;
- large text: at least 3:1;
- controls, icons, focus indicators, and meaningful graphics: at least 3:1.

Check hover, active, disabled, selected, error, overlays, and text over images.
Every state encoded by color also needs text, shape, iconography, position, or
another cue. Charts need labels, patterns, shapes, or sufficient luminance
separation.

## Verify

Every color should have a stable semantic role or a deliberate atmospheric
purpose. The palette must work in dense, quiet, interactive, empty, and failure
states without hiding the primary action or current state.
