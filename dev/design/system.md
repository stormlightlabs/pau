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

Every relevant control state needs a visible treatment. Icon-only controls need
an accessible name and, where meaning is not obvious, a tooltip or adjacent
label. Destructive actions name the object and preserve a cancel or recovery
path where practical.

## Motion

Routine state changes should complete in about 100–250ms. Use motion to show
selection, panel disclosure, layout continuity, progress, and feedback. Task
surface changes use a short fade and small directional offset to preserve place.
Do not sequence the whole product into view or animate live status merely to
imply activity.

Reduced motion removes spatial movement and indefinite decoration while keeping
immediate state and short color feedback. Svelte motion and transition APIs own
application motion.

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
