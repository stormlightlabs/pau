# Product interface system

Pau is an operating interface for developers supervising agents and working in
local repositories. The interface should feel direct, calm, and technically
precise. It should not resemble an analytics dashboard or hide process state
behind decorative summaries.

This document owns durable visual and interaction decisions. Product behavior
comes from [`SPEC.md`](../SPEC.md). Architecture and implementation policy come
from [`PLAN.md`](../PLAN.md).

## Surface mode

The product uses **Operate** mode. Task completion, state, scanability, and
familiar controls outrank visual novelty. Density is useful because operators
compare concurrent work, files, checks, and process state throughout the day.

The primary path is:

1. Find work that is active or needs attention.
2. Open one session or workspace surface.
3. Read current state and act without losing context.
4. Inspect details, changes, or checks when needed.
5. Return to the task with the same process still running.

## Visual thesis

Use a flat, dark workbench divided by alignment and restrained rules. The main
task surface leads. Rails and inspectors remain visibly secondary. Small areas
of bright color identify action, selection, focus, and state.

The interface should be recognizable by:

- precise multi-pane composition;
- compact but readable type;
- mostly square geometry, hairline separators, and slight rounding on
  free-standing controls and overlays;
- visible native-process and workspace state;
- agent, file, Git, terminal, and editor details that use their real visual
  vocabulary.

Avoid nested cards, floating glass surfaces, heavy shadows, ornamental terminal
motifs, and large dashboard metrics without an operator task.

## Layout regions

The wide application shell may contain:

- a persistent product rail;
- a contextual workspace or section rail;
- one main task surface;
- an optional inspector;
- a terminal dock that splits only the main column.

The main surface must retain the largest useful width. The inspector holds
selected detail, plans, checks, permissions, diffs, or resource configuration.
It must not become a second navigation rail.

Each product rail item opens a working view and marks the current one. An item
whose view is not ready yet stays visible but disabled, with a "Coming soon"
tooltip. Workspace views stay disabled until a workspace is open. A view
without a contextual rail gives that column to the main surface.

The application shell fills the viewport and prevents document overscroll.
Persistent rails and the main task surface scroll independently, so navigation
and task context remain available with long content. Nested panes contain their
scroll instead of chaining it into the shell.

At narrower widths:

1. Remove the inspector from the grid and open it as an overlay or full view.
2. Collapse the contextual rail.
3. Keep the product rail while its destinations still fit and remain useful.
4. Give conversation, editor, and terminal surfaces the remaining area.
5. Use a focused full-surface view when the task cannot tolerate persistent
   chrome.

Do not scale the desktop composition down. Recompose it.

## Spatial system

The spacing scale uses 4, 8, 12, 16, 24, and 32px steps, named `space/1` to
`space/6`. Use tight intervals within controls and rows, medium intervals within
a section, and larger intervals between distinct tasks.

The Scale collection in `pau.fig` names the spacing, type, radius, border, row,
and rail values. `packages/ui` mirrors those names as CSS custom properties, so
`space/3` becomes `--pau-space-3` and `size/row-md` becomes
`--pau-size-row-md`. Type sizes use `--pau-type-*` because `--pau-text` names
the text color.

- Product rail: about 48–56px.
- Context rail: about 224–256px.
- Inspector: about 288–320px.
- Compact rows: 28–36px when keyboard and pointer use dominate.
- Coarse-pointer targets: at least 44px even when the visible icon is smaller.

Use faint 0.5 CSS pixel rules where a stable pane boundary needs a divider.
Increase them to one pixel when the user requests more contrast. Adjacent rails
and sidebars may rely on surface color and spacing instead of a border.
Selected-row indicators stay stronger than structural rules. Reserve shadows
for overlays that occlude content. Keep pane boundaries, rows, tabs, and
attached controls square. Free-standing controls use a 3px radius. Floating
surfaces and overlays may use up to 5px.

## Typography

IBM Plex Sans Variable is the default application face. Operators may select
Inter Variable, Atkinson Hyperlegible Next Variable, or Atkinson Hyperlegible
Soft. Font choice must not change layout roles. IBM Plex Mono sets code,
commands, paths, and identifiers in every UI font choice.

- Use the fixed product type scale: 12, 13, 14, 16, and 20px.
- Keep ordinary transcript prose near 14–16px with a maximum measure of about
  74 characters.
- Keep metadata readable at 12–13px with sufficient contrast and line height.
  No product text goes below 12px.
- Use weight and spacing before large size jumps.
- Use monospace for code, commands, paths, identifiers, terminal output, and
  aligned counts. Do not use it as a general technical accent.
- Use tabular numerals for durations, counts, and diff statistics.

The prototype workbench outside the mock application may use a larger title, but
it should still read as a design tool rather than a marketing page.

## Color and themes

Every theme maps the same semantic roles:

- canvas, surface, raised surface, and selected surface;
- normal, muted, and disabled text;
- border and strong border;
- accent, focus, and selection;
- positive, warning, danger, and information;
- syntax, diff, editor, and terminal ANSI roles.

The first release themes are Eldritch, Nord, Iceberg, Catppuccin Mocha, and
Vitesse Dark. Palette values come from their upstream projects and retain the
required attribution.

Spend accent color on the primary action, current selection, focus, and active
state. Muted copy must remain legible on every surface. State always combines
color with text, shape, icon, or position.

## Components and controls

Use one control vocabulary across screens:

- primary button for the action that advances the current task;
- secondary button for alternatives;
- quiet or icon button for local utilities;
- left-edge indicator plus surface change for selected rows;
- compact chips for scope, branch, model, state, and attached context;
- section labels for stable pane regions, not as decoration above every block.

Controls that show or hide a rail, sidebar, or inspector belong in the top app
bar. Keep task-specific actions in the task surface.

Sessions, workspaces, files, and transcript messages open a context menu on
right-click, `Shift+F10`, or the menu key. The menu is an in-app popover in the
top layer, not a native menu, so it uses the theme tokens, behaves the same in
the browser and the desktop app, and can show why an action is disabled. It
lists only actions the item supports. An action that is planned but not ready,
or that the item's state refuses, stays visible and disabled with its reason
underneath. Escape, Tab, or a choice closes the menu and returns focus to the
item. File menus can reveal a file in the system file manager but never launch
it in another application, because the webview renders agent-generated content.

Every relevant control state needs a visible treatment. Icon-only controls need
an accessible name and, where meaning is not obvious, a tooltip or adjacent
label. Destructive actions name the object and preserve a cancel or recovery
path where practical.

## Motion

Motion shows cause, continuity, and state. It never decorates, never delays
input, and never moves content the operator is reading.

### Tokens

`packages/ui/src/styles/tokens.css` defines theme-independent motion tokens
next to the scale tokens. `packages/ui/src/motion.ts` exports the same values
for Svelte transitions, and a contract test keeps the two in sync. No
component uses a literal duration or easing keyword.

```css
:root {
	--pau-duration-instant: 0ms;
	--pau-duration-feedback: 100ms;
	--pau-duration-small: 150ms;
	--pau-duration-medium: 200ms;
	--pau-duration-large: 250ms;

	--pau-ease-standard: cubic-bezier(0.2, 0, 0, 1);
	--pau-ease-enter: cubic-bezier(0.05, 0.7, 0.1, 1);
	--pau-ease-exit: cubic-bezier(0.3, 0, 0.8, 0.15);
	--pau-ease-linear: linear;

	--pau-motion-offset-sm: 0.25rem;
	--pau-motion-offset-md: 0.5rem;
	--pau-motion-scale-enter: 0.98;
	--pau-motion-travel: 1;
}

:root[data-motion='reduce'] {
	--pau-motion-offset-sm: 0;
	--pau-motion-offset-md: 0;
	--pau-motion-scale-enter: 1;
	--pau-motion-travel: 0;
}
```

`--pau-motion-travel` multiplies full-width travel, such as a rail sliding in
from its edge.

- `instant`: keyboard-initiated and high-frequency actions.
- `feedback`: hover, press, selection, state color, chevron rotation.
- `small`: popover and menu entry, scrim fade, content fade after a pane
  toggle.
- `medium`: dialog entry, overlay rail entry, toast entry, disclosure
  expansion.
- `large`: task-surface changes. Nothing routine exceeds it.
- `standard` easing moves and recolors elements that stay on screen.
- `enter` easing brings elements in. `exit` easing takes them out.
- `linear` is for progress and spinners only.
- Exits use the next shorter duration than their entrance.

The busy-indicator rules use two TypeScript constants: show after 400ms and
stay visible for at least 500ms.

### Rules by component class

| Component                      | Enter                                 | Exit     | Notes                          |
| ------------------------------ | ------------------------------------- | -------- | ------------------------------ |
| Hover and press                | feedback, color only                  | feedback | Instant in dense lists         |
| Focus ring                     | instant                               | instant  | Never transition `outline`     |
| Selection indicator            | feedback, color                       | feedback | No sliding indicator           |
| Session status                 | feedback, color                       | feedback | One spinner only for running   |
| Attention marker               | one 600ms pulse                       | instant  | Static badge after the pulse   |
| Disclosure (tool, thinking)    | medium, rows 0fr to 1fr               | small    | Instant if streaming or tall   |
| Popover, menu (pointer)        | small, fade and scale-enter           | feedback | Origin at the anchor           |
| Completion list (keyboard)     | instant                               | instant  |                                |
| Command palette                | instant, feedback fade from a pointer | instant  | No fade under reduced motion   |
| Dialog                         | medium, fade and scale-enter          | small    | Backdrop fades with it         |
| Overlay rail, narrow inspector | medium, translate from edge           | small    | Scrim fades over small         |
| Wide inspector, rail toggle    | instant layout, small fade            | instant  | No per-frame reflow            |
| Toast                          | medium, offset-md from edge           | small    | Same edge in and out           |
| Task-surface change            | large, fade and offset-sm             | none     | Keyboard navigation is instant |
| Terminal tab                   | instant                               | instant  | Never animate the canvas       |
| Diff hunk update               | 1s background tint fade               | —        | Static marker when reduced     |
| Transcript streaming           | none                                  | —        | Append per frame, no fades     |
| Follow-mode scroll             | jump                                  | —        | No smooth scrolling            |

Interaction rules:

- Animations never block input. An overlay that is leaving does not hold
  focus or intercept clicks.
- Interrupting a transition reverses it from its current state.
- Content above the reading position does not move when entries stream,
  expand, collapse, or when notices appear.
- Every overlay returns focus to its invoker, or to the composer if the
  invoker is gone.
- Prompts, renames, and queue edits update locally first and roll back on
  error. Process control waits for the process.
- Waits under 400ms show no indicator. Waits over 10s show elapsed time or
  determinate progress and a cancel control where supported.

### Reduced motion

The root element's `data-motion` attribute is `reduce` or `full`. When it is
absent, the OS `prefers-reduced-motion` query applies, in `tokens.css` and in
`isReducedMotion()` from `motion.ts`. The operator's motion setting (system,
reduce, or full) will write the attribute. Storybook's reduced-motion control
sets it directly.

Under reduced motion:

- Distance and scale tokens collapse, so movement becomes a fade.
- Opacity and color feedback stays at `feedback` duration or less.
- Spinners and pulses become static marks.
- Svelte transitions read the shared motion setting and drop movement.
- Smooth scrolling is off.

### Focus ring

Every focusable control draws the same ring: `--pau-focus-width` (2px) in
`--pau-focus`, offset by `--pau-focus-offset` (2px) outside the control. Inside
scroll containers, edge-to-edge rows, and overlay rails, where an outset ring
would be clipped, use `--pau-focus-offset-inset` (-2px) so the ring stays
inside the control. Controls that draw focus another way, such as the pane
resizer's separator line, use the same color and width.

### Increased contrast

Under `prefers-contrast: more`, hairline rules become 1px, muted text moves
toward normal text, and `--pau-focus-width` becomes 3px. Under
`forced-colors: active`, focus and selection use system colors.

### Performance budgets

Measured on the reference dogfood machine, a 120Hz MacBook Pro, in the
installed app:

- Input to visible feedback: 50ms target, 100ms ceiling.
- Any interaction to next paint: under 200ms.
- Main-thread work per frame during animation or streaming: under 8ms.
- No long task over 50ms while streaming a 2,000-delta fixture at 50 deltas
  per second.
- At most one transcript state commit per animation frame while streaming.
- Session switch to a readable transcript: under 100ms for a cached session.
- Zero movement of the first visible transcript entry during streaming,
  disclosure, and notice changes.
- Animated properties: `transform` and `opacity`, plus `color`,
  `background-color`, and `border-color` for feedback.

## Content and state

Copy names the real object, operation, and consequence. A lost UI connection is
not a stopped native process. A queued prompt is not running work. A capability
that an adapter does not report is unavailable, not broken.

Representative surfaces should cover:

- starting, idle, running, waiting, stopping, stopped, and failed sessions;
- disconnected UI with surviving native work;
- loading, empty, error, success, disabled, and permission states;
- long paths, session names, output, and translated labels;
- partial replay or bounded history where relevant.

## Verification

Inspect each changed composition at desktop and narrow widths. Check hierarchy,
overflow, focus, keyboard operation, coarse-pointer targets, reduced motion,
long content, and the most important alternate state. Screenshot fixtures record
compositions, but behavior checks must verify controls.
