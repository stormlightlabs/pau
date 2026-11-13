# Layout

Layout turns product priority into reading order, grouping, rhythm, and usable
space. Diagnose the relationship before moving boxes.

## Assess

Inspect representative states and widths.

- **Reading order:** With detail blurred, which element leads, what supports it,
  and where does the eye go next?
- **Grouping:** Are related items close? Are distinct groups separated without
  excessive containers?
- **Rhythm:** Do tight and generous intervals form a cadence, or does one gap
  make every relationship look equal?
- **Topology:** Does the structure match the task, or merely the framework's
  default grid?
- **Density:** Does each region carry the amount of information its frequency
  and decision complexity justify?
- **Extremes:** What happens with empty data, long text, overlays, sticky
  elements, zoom, and localization?

## Set a spatial thesis

Name the primary task path, the leading region, the supporting regions, the
intended density, and what collapses or moves at narrow widths.

Choose the simplest model that expresses those relationships. Use semantic
layout roles and a documented spacing scale. A 4px base often provides useful
compact steps; the exact base must fit the established system.

## Apply

- Use proximity and alignment before borders, backgrounds, and shadows.
- Keep tight spacing within a group and larger spacing between groups.
- Use `gap` for sibling relationships when it is clearer than child margins.
- Let important content own space; do not force genuinely unequal content into
  equal cards or columns.
- Keep product chrome stable while task content can scroll or adapt.
- Use flat regions and restrained dividers for dense operating interfaces.
- Add depth only to communicate elevation, occlusion, drag state, or focus.
- Keep overlays out of clipping ancestors. Prefer `dialog`, the popover API,
  fixed positioning, or a portal where appropriate.
- Make optical corrections after inspecting the rendered result.

## Product layouts

A common wide operating layout may include a global rail, contextual rail,
main task surface, and optional inspector. This is a starting model, not a
requirement.

- Keep the main task surface dominant.
- Collapse contextual navigation before global navigation when space tightens.
- Move optional inspectors to an overlay or full view rather than crushing the
  task surface.
- Let terminals, canvases, editors, and media use the available main area.
- Reserve persistent split views for information that users need at the same
  time.

## Verify

- The squint test still reveals the intended order.
- Related content groups naturally and distinct content stays distinct.
- Spacing contrast expresses relationships rather than decoration.
- The task path remains clear at narrow, intermediate, and wide widths.
- Visual order, DOM order, and focus order agree.
- Long labels, empty states, menus, and overlays do not break or clip.
