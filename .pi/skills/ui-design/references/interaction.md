# Interaction

Controls should behave like their role, expose state, and make cause and result
clear.

## Controls and states

For each interactive component, cover the states that can occur: default,
hover, focus, active, selected, disabled, loading, error, and success.

- Use semantic elements before ARIA or click handlers on generic elements.
- Give every control an accessible name. Pair unfamiliar icons with text or a
  discoverable label.
- Keep focus visible and ensure keyboard order follows the task.
- Make destructive actions explicit and preserve an escape or undo path where
  practical.
- Use familiar controls for familiar tasks. Do not invent a custom affordance
  merely to add character.
- Keep hit areas at least 44 by 44 CSS pixels where practical. Dense desktop UI
  may use smaller visible marks, but coarse-pointer targets still need adequate
  space and separation.
- Do not rely on hover for essential content or action.

## Forms

- Use persistent labels, useful autocomplete, correct input types, and sensible
  defaults.
- Put specific errors next to their fields, preserve input, and move focus or
  announce the summary when submission fails.
- State constraints before the user violates them when the constraint is not
  obvious.
- Disable repeat submission while work is pending, but do not erase controls or
  context.
- Avoid placeholder text as the only label or instruction.

## Overlays and navigation

Use modals only when the user must resolve a focused interruption before
continuing. Prefer inline disclosure, side panels, popovers, or dedicated views
for work that benefits from context.

Manage focus on open and close, support Escape when safe, trap focus only in
true modal surfaces, and prevent overlays from clipping or leaving the viewport.

## UX copy

- Use the reader's terms, not implementation labels.
- Label actions with verbs that name the result: “Open workspace,” “Retry,” or
  “Stop session.”
- State what happened, whether work is safe, and what the user can do next.
- Keep one term for one object or action across screens.
- Avoid vague errors, false urgency, and unsupported claims.

## Motion

Motion should acknowledge action, explain state or spatial relationship, and
preserve continuity. Product motion is usually 100–300ms. Larger overlays or
layout transitions may need 300–500ms. Exit faster than entrance.

- Prefer natural deceleration; avoid bounce or elastic easing by reflex.
- Use transforms and opacity for routine transitions, but choose other
  properties when they better explain the state and remain performant.
- Do not animate every section on load.
- Keep content visible if scripts fail.
- Make repeated motion interruptible.
- Respect `prefers-reduced-motion` with a deliberate alternative. Reduce spatial
  movement while preserving feedback through immediate state, color, or short
  fades. Do not use a global rule that removes meaningful feedback.

Verify with keyboard, pointer, coarse pointer, and reduced motion when those
paths apply.
