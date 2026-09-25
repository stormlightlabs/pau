---
name: ui-design
description: Design, review, refine, and document browser-based interfaces. Use for product UI, dashboards, settings, editors, forms, responsive layouts, visual systems, accessibility, UX copy, motion, prototypes, and design critiques. Not for terminal interfaces or backend-only work.
license: Apache-2.0; see NOTICE.md
---

# UI design

Create usable, specific interfaces with a coherent visual point of view. Preserve
working behavior, product truth, accessibility, and the project's established
system. A narrow refinement does not justify a redesign.

This skill contains guidance only. It has no installer, hooks, detector, browser
runtime, generated context, or project-specific state.

## Read the right references

Read only what the task needs. Read all references for a broad build or review.

- `references/direction.md`: context, surface modes, visual direction, and
  anti-patterns.
- `references/layout.md`: hierarchy, grouping, density, spacing, and surfaces.
- `references/typography.md`: type roles, hierarchy, measure, and font delivery.
- `references/color.md`: semantic palettes, contrast, themes, and data color.
- `references/interaction.md`: controls, states, forms, overlays, copy, and
  motion.
- `references/responsive.md`: narrow layouts, input modes, containers, zoom,
  and safe areas.
- `references/hardening.md`: loading, errors, empty states, long content, i18n,
  and failure paths.
- `references/review.md`: critique, technical audit, visual verification, and
  handoff.

## Establish context before editing

1. Read the product brief and the owning design documents.
2. Inspect the target and one representative source of visual truth: tokens,
   shared styles, a neighboring screen, a theme, or a brand asset.
3. Name the surface mode:

   - **Persuade:** help someone decide and act.
   - **Operate:** help someone complete a task.
   - **Read:** help someone understand material.
   - **Experience:** let the work itself lead.

4. State the audience, primary task, usage setting, constraints, and the one
   visual idea that should remain memorable.
5. Decide whether to preserve, extend, or replace the incumbent system. Ask
   before replacing an established identity or changing factual copy.

Do not ask the user to choose arbitrary CSS values or style labels. Ask only
when missing product truth would change the result.

## Work from task to detail

Use this order:

1. Confirm the primary task and reading order.
2. Fix information architecture and interaction flow.
3. Set hierarchy, layout, grouping, and responsive behavior.
4. Apply typography, color, iconography, and motion through semantic roles.
5. Cover loading, empty, error, success, disabled, permission, and long-content
   states that the surface can encounter.
6. Implement real controls and preserve keyboard, screen-reader, touch, and
   reduced-motion paths.
7. Inspect rendered desktop and narrow states in one bounded pass, fix findings
   together, and confirm once.

Prefer tokens and existing components. Promote a value or pattern only when it
is genuinely reused. Do not build an abstraction for one local exception.

## Quality floor

- The first viewport makes the purpose and current state clear.
- One element or task leads; supporting information has visibly lower weight.
- Proximity and alignment group content before borders, cards, or shadows do.
- Product UI uses stable density, familiar controls, and short state-driven
  motion. Expression lives in precise details rather than invented affordances.
- Every control has an accessible name, visible focus, and relevant states.
- Color is never the only state cue. Text and controls meet WCAG AA contrast.
- Narrow layouts recompose instead of shrinking the desktop arrangement.
- Real copy, long labels, empty data, failure states, and zoom do not break the
  design.
- Decorative effects never obscure the task or claim attention needed by
  status, content, or action.

## Avoid reflex design

Unless the brief gives a reason, avoid generic hero-and-card compositions,
cards nested inside cards, purple-blue gradients, decorative glass, neon glows,
gray text on colored surfaces, pure black-and-gray palettes, rounded-square icon
tiles, repeated uppercase eyebrows, ornamental monospace, identical reveal
animations, bounce easing, and excessive pill controls.

System fonts, cards, gradients, and familiar navigation are not forbidden. Use
them when they fit the product, not because they are defaults.

## Keep design records current

When a design decision changes, update the owning design document in the same
change. Record durable rationale, roles, and constraints. Do not turn design
documents into implementation logs, screenshot galleries, or duplicate product
specifications.
