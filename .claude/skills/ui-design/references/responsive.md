# Responsive design

Responsive work preserves priority and task completion as space, input mode,
content, and user settings change. It is not a smaller desktop composition.

## Start from content pressure

Choose breakpoints where the current relationships stop working, not from a
device list. Inspect narrow, intermediate, and wide states with real copy.
Decide for each region whether it remains, wraps, reflows, collapses, moves to an
overlay, becomes a full view, or scrolls within a named axis.

## Recompose by priority

- Keep the primary task and current state visible.
- Collapse optional context before essential global navigation when that matches
  the product's hierarchy.
- Move inspectors and secondary detail to overlays or dedicated views rather
  than compressing editors, terminals, canvases, and conversations.
- Turn wide tables into deliberate horizontal scroll, column reduction, or a
  row-detail pattern. Do not silently drop data.
- Keep primary actions reachable and stable.
- Let components respond to their container when they appear in several layout
  contexts.

## Input modes

Use media features such as `pointer`, `hover`, and `prefers-reduced-motion` when
behavior depends on capability. A narrow viewport is not proof of touch, and a
wide viewport is not proof of mouse input.

- Maintain 44px coarse-pointer targets and enough separation.
- Supply visible focus and keyboard alternatives.
- Avoid hover-only menus and mouse-only drag handling.
- Clear drag state on pointer cancel, lost capture, release outside, and window
  blur.

## Viewport and platform details

- Use logical properties so RTL does not require a second layout.
- Account for safe-area insets in full-height mobile surfaces.
- Prefer dynamic viewport units with a suitable fallback when browser chrome
  changes height.
- Keep form text at 16px on iOS to avoid forced zoom.
- Do not hide overflow to conceal structural bugs.
- Keep visual order, source order, and focus order aligned.

## Stress test

Check 320px width, intermediate widths, wide screens, 200% zoom, text scaling,
landscape, coarse pointer, long localization, open keyboards, and scrollable or
sticky regions. Confirm there is no accidental horizontal overflow or unreachable
control.
