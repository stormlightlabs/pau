# Product interface system

Pau is an operating interface for developers supervising agents and working in
local repositories. The interface should feel direct, calm, and technically
precise. It should not resemble an analytics dashboard or hide process state
behind decorative summaries.

This document owns durable visual and interaction decisions. Product behavior
comes from the Product specification, and architecture and implementation
policy from the Technical plan. Both live in the project's issue tracker.

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
   Keep it closed until the operator opens it, so new detail never covers the
   main surface.
2. Collapse the contextual rail.
3. Keep the product rail while its destinations still fit and remain useful.
4. Give conversation, editor, and terminal surfaces the remaining area.
5. Use a focused full-surface view when the task cannot tolerate persistent
   chrome.

Do not scale the desktop composition down. Recompose it.

The composer footer holds two groups: quiet options (delivery mode, model,
thinking, permission, context) and the actions. They share one row when both
fit, such as at 1440×900 with the session rail hidden. When they no longer
fit, including at 1440×900 with both the session rail and the context rail
open, the actions keep the first row under the field and the options wrap
below them. In a narrow footer, the context meter shows only the share used,
and its details still list the window and token totals. Completion lists open
as a popover above the composer, so the composer keeps its height and the
transcript does not move.

While files are dragged over the composer, a drop target covers the
composer's own box and dashes its border: focus color when the drop would
attach images, danger color with the reason when it would not. The composer
and the status line keep their size and place.

The status line under the composer starts and ends with the composer's
controls and sets the folder, branch, and figures in the mono metadata role.
Figures that are still zero stay hidden. When space runs short, the path loses
its start first, the branch keeps its name up to a cap, the figures never
shrink, and extension statuses wrap to a second row.

## Spatial system

The spacing scale uses 4, 8, 12, 16, 24, and 32px steps, named `space/1` to
`space/6`. Use tight intervals within controls and rows, medium intervals within
a section, and larger intervals between distinct tasks.

The spacing, type, radius, border, row, and rail values have slash-separated
token names. `packages/ui/src/styles/tokens.css` records them as CSS custom
properties, so `space/3` becomes `--pau-space-3` and `size/row-md` becomes
`--pau-size-row-md`. Type sizes use `--pau-type-*` because `--pau-text` names
the text color.

Content in a rail, and in a view that runs edge to edge such as Files, starts
`space/4` in from the column's edge. Rail headings, section labels, the branch
row, the search field, top-level tree rows, the view title, and the bars under
it share that leading edge. An edge-to-edge view cancels the main surface's
padding with the shell's own value at every width, so it never overhangs the
column.

- Desktop window: first opens at 1440×900, within 90% of the screen, and never
  smaller than 800×560, so the context rail always fits beside the session.
  Later launches restore the last size, position, and maximized state. If the
  saved position is off every connected display, the window opens centered at
  the first-launch size.
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

Overpass Variable is the default application face. Operators may select IBM
Plex Sans Variable, Inter Variable, Atkinson Hyperlegible Next Variable, or
Atkinson Hyperlegible Soft. Font choice must not change layout roles. Overpass
Mono Variable sets code, commands, paths, and identifiers in every UI font
choice.

Use the fixed product type scale of 11, 12, 13, 14, 16, and 18px and the
weights 400, 500, and 600. Fold any heavier weight into 600.

| Element                              | Size    | Weight |
| ------------------------------------ | ------- | ------ |
| Main task heading                    | 18px    | 600    |
| Application body                     | 14px    | 400    |
| Workspace names and inspector values | 13px    | 500    |
| Commands, paths, and metadata        | 12–13px | 400    |
| Section labels                       | 11px    | 600    |

- Set transcript prose, the composer, dialog and settings body text, and the
  primary text of list rows at 14px. Keep ordinary transcript prose to a
  maximum measure of about 74 characters.
- Keep metadata readable at 12–13px with sufficient contrast and line height.
  No product text goes below 12px, except uppercase, letter-spaced section
  labels, which may use 11px.
- Every main surface names its task with the one view title role
  (`pau-view-title`, 18px/600): the session title, Files, Processes,
  Diagnostics, MCP, Sandbox, the saved-session picker, and an empty state that
  fills the surface. A count or status chip beside the title centers on the
  title line.
- Labels that name a pane region, such as rail headings, "Search files", and
  "Queued", use the one section label role (`pau-section-label`): 11px/600,
  uppercase, and tracked, in muted text unless a state recolors it.
- Markdown headings descend one step per level, all at 600: h1 18px, h2 16px,
  h3 14px, and h4–h6 13px, with h5 and h6 muted.
- Use weight and spacing before large size jumps.
- Use monospace for code, commands, paths, identifiers, terminal output, and
  aligned counts. Do not use it as a general technical accent.
- Use tabular numerals for durations, counts, and diff statistics.

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

Each surface has at most one accent primary: the action that moves its task
forward, such as Send prompt in the composer, Open workspace on first run,
Start session in an empty workspace, Start again in a stopped session, Save in
the editor, Open a terminal with no terminals open, and Resume on the newest
saved session in the picker. Other actions on that surface are secondary or
quiet. A notice inside a surface, such as the Pi readiness notice, uses
secondary buttons so it never competes with the surface's primary. Actions that
remove or end something use the danger variant. A disabled primary drops the
accent fill for the raised surface and muted text, and never relies on
opacity, so it cannot read as enabled. A disabled secondary fades its outline,
so a row of unavailable actions still ranks the primary first. The shared
`pau-button` variants in `packages/ui` own these colors and the size: a
`row-md` (32px) height and `type-md` (14px) text in every view, toolbars and
banners included. Components place and space buttons but do not resize them.

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

Single-choice settings use the shared `Select` dropdown instead of a native
`<select>`. The trigger is a field: control row height, control radius, the
border token, the current label, and the token chevron at the end. Options
show readable labels, such as "Extra high" for Pi's `xhigh`, while the stored
value stays raw. The list opens in the top layer on the raised surface, below
the trigger or above it near the bottom edge, with fixed-height rows and a
check mark on the selected option. It follows the select-only combobox
pattern: Space, Enter, or Alt+Down opens it, arrows, Home, End, and typing
move, Enter or Space chooses, and Escape or Tab closes it. A disabled option
or control states its reason. A change that the agent rejects shows the error
and restores the previous value. The error sits where the list would open,
starts at the trigger's left edge, and moves left only to stay inside the
window. A pointer open fades in like other popovers.
A keyboard open, or any open under reduced motion, appears at once. The model
picker and the context meter use the same trigger, chevron, and list surface,
and the current model shows the check mark. Pickers in the composer footer
open their list and error upward from the top of the footer, and below only
when the space above is too short, so neither covers Attach image or Send
prompt when the actions sit on the row above them.

Transcript entries start at the transcript's left edge, where assistant prose
and the session title start. Everything else in an entry starts on one inset,
`space/5` in from that edge: user message text, disclosure summaries, tool
bodies, and the calls inside a tool group. A left rule, such as the user
message bar or a tool row's line, counts toward the inset, so the text does not
move with the rule's width. Calls inside a group sit under the group's rule
with no further indent. Thinking, tool rows, tool groups, and compaction
markers share one disclosure treatment from `disclosure.css`: a right chevron
centered in the inset that turns down while the entry is open, muted summary
text that turns to normal text on hover, and no native marker. A failed tool
row colors its chevron with the danger role.

Status marks in a row get a column as wide as the mark and sit `space/2` from
the label, in the session rail as in the session header. Session rail names
start at the same offset as the shell context rail's labels, and the mark lines
up with the workspace name above it. The rail's icon buttons match the
`size/row-md` height of its Open workspace button.

Hover and press change color only. No control moves, scales, or resizes when
pressed, so a pressed row never shifts its neighbors. The shared rules in
`packages/ui/src/styles` own these states for each control class:

- Buttons: secondary, quiet, and danger buttons tint their fill and strengthen
  the border on hover, and tint further on press. The primary moves its accent
  toward the text color, a quarter on hover and nearly half on press.
- Utility buttons (`pau-utility-button`), such as rail icons, toolbar icons,
  and Copy: muted rest, normal text and a tint on hover, a stronger tint on
  press.
- Rows (`pau-row`): rail rows, tree rows, tabs, result rows, and completion
  options use the same tints and turn muted text to normal text. A selected
  row keeps its selection fill under the pointer.
- Popover options (`pau-option`) on the raised surface take the selection fill
  on hover, as keyboard movement shows it, and step down to the surface on
  press.
- Dropdown triggers (`pau-field`), including the composer's quiet triggers,
  draw the accent border on hover and tint on press.
- Choice rows move the native input's accent fill, disclosure summaries lift to
  normal text and tint on press, and links move the accent toward text.

The hover and press tints are 5% and 8% of the theme's text color laid over
the control's own fill, so one value works on the canvas and the surface. Press
stays at 8% so muted and danger text keep 4.5:1 in every theme. Hover rules
apply only under `(hover: hover)`, so a tap on a touch screen never leaves a
control looking hovered. Disabled controls ignore hover and press. A disabled
row or utility button fades to half opacity, because its rest color is already
muted, and a disabled quiet button fades its muted text further.

Every relevant control state needs a visible treatment. Icon-only controls need
an accessible name and, where meaning is not obvious, a tooltip or adjacent
label. Destructive actions name the object and preserve a cancel or recovery
path where practical.

Radio buttons and checkboxes stay native and sit `space/2` from their labels.
The shared `pau-choice` row clears the browser's input margin, which would
otherwise push the gap off the spacing scale. Text fields and settings panels
draw their edges with the theme border token.

## Keyboard

Pau matches Pi's workflows, not every Pi key. Three rules decide which chord an
action gets:

- In the composer and the session, Pi's keys apply. Sending, steering,
  queueing, interrupting, changing the thinking level, and opening the model
  picker use Pi's defaults, and the operator's `keybindings.json` overrides
  them.
- Actions that Pi does not have follow the platform: ⌘ chords on macOS and
  Ctrl chords on Linux, as in other desktop editors. This covers the command
  palette, session switching, panels, zoom, and settings.
- A Pi binding takes a chord from Pau only where it applies. Pi's text-editing
  bindings, such as Ctrl+K for deleting to the end of the line, apply while
  the composer has focus. Pi's application bindings, such as Ctrl+Shift+P for
  the previous model, apply everywhere.

Pi's interrupt key, Escape by default, follows Pi's order in the composer: an
open completion list closes first, then a running turn is interrupted, and
only when no turn runs does the key stop a running `!` shell command.

The shortcut list shows each action's chord, and names the Pi binding that
took a chord from Pau and where it applies.

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

`busyIndicatorTiming` in `motion.ts` holds the busy-indicator timing: show
after 400ms and stay visible for at least 500ms. `BusyIndicator` in
`packages/ui` applies it. While a shown indicator waits out its 500ms, the
content that replaces it waits too, and a `role="status"` indicator renders
only once shown, so screen readers announce what sighted operators see.
Indicators for an operation already visible in progress, such as a running
tool row or session status, are not delayed.

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
- Dropdowns, lists, details panels, and menus close on a press outside them,
  Escape, or the window losing focus. A press on another control's trigger
  closes the open overlay and opens that one in the same press. A press that
  lands on a focusable element keeps focus there.
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

The shell shows the backend connection only while it is down. A healthy
connection shows no label, because "Connected" reads as a claim that Pi works.

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
