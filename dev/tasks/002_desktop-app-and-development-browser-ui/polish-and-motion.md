# 2. Desktop app: Polish and motion

## Polish and motion

### 2.236 Design file rebuild

Status: planned
Blocked by: none

Clear `pau.fig` and rebuild it from `dev/design`. Until this unit is complete,
the prototype HTML pages are the visual reference wherever the file disagrees.

- Save a copy of the current file before clearing it.
- Recreate the Theme, Site, and Scale variable collections from
  `dev/prototype/styles/tokens.css`, using Overpass and Overpass Mono and the
  type scale in `dev/design/system.md`.
- Build the shared components first: the top bar, product rail, context rail,
  buttons, fields, the dropdown and its list, chips, tabs, section labels,
  disclosure rows, the composer footer, and the Pau and agent marks. Bind
  every color, type size, spacing, and radius to a variable.
- Build each screen in `dev/design/surfaces.md` from those components at
  1440×900, with a 900px frame for each surface that recomposes when narrow.
- Draw the session states that the prototype lacks: pending and "Not sent"
  prompts, an open model list, and a long transcript.
- Draw the session status line from 2.278 and record its layout in
  `dev/design/system.md`.
- Drop the old prototype site chrome: the workbench sidebar, page header, and
  hub card.
- Update `dev/prototype/README.md` to describe the rebuilt file.

Verification:

- Run the OpenPencil lint and overlap analysis on every page and fix each
  finding.
- Measure each frame's rows: controls in a row share a center line, and
  stacked content shares a leading edge.
- Compare each frame's structure and copy against its HTML page, and list
  every place where the shipped application differs from the frame.

### 2.221 Busy indicator timing

Status: planned
Blocked by: none

Delay loading and busy indicators by 400ms and keep them visible for at least
500ms once shown.

Verification:

- Unit-test the timing with fake timers, including a wait that ends before the
  delay and one that ends during the minimum display.
- Apply it to the session-list loading state and confirm a fast load shows no
  indicator.

### 2.222 Disclosure motion

Status: planned
Blocked by: none

Animate tool and thinking block expansion for finished blocks shorter than one
viewport, and switch instantly otherwise.

Verification:

- Component-test that a short finished block animates, a streaming or tall
  block does not, and reduced motion removes the animation.
- Check the animation in WebKit.

### 2.223 Inspector toggle

Status: planned
Blocked by: none

Open and close the wide inspector and context rail without per-frame
transcript reflow, fading their content in.

Verification:

- Component-test toggling from the top app bar and the keyboard, and that the
  keyboard path is instant.

### 2.224 Narrow overlay motion

Status: planned
Blocked by: none

Slide the narrow context rail and inspector overlay from their edges over a
fading scrim.

Verification:

- Component-test opening, closing by scrim click and Escape, and the fade-only
  presentation under reduced motion.

### 2.225 Popover presentation

Status: planned
Blocked by: none

Fade and scale pointer-opened pickers and meters from their anchor, keep
keyboard-opened completion lists instant, and close any open popover before
another opens.

Verification:

- Component-test the model picker, thinking-level picker, and context meter
  opened by pointer and keyboard, and opening one while another is open.

### 2.226 Dialog presentation

Status: planned
Blocked by: none

Fade and scale extension dialogs in and out, keeping each mounted until its
exit finishes.

Verification:

- Component-test opening, confirming, cancelling, and a new request arriving
  while the previous dialog exits.

### 2.227 Task-surface transition

Status: planned
Blocked by: none

Fade new task surfaces in with a small offset when the operator navigates by
pointer, and switch instantly from the keyboard.

Verification:

- Component-test that the incoming surface is interactive at once and that the
  keyboard path and reduced motion skip the offset.

### 2.228 Notification toasts

Status: planned
Blocked by: none

Show extension and application notices as dismissible toasts that pause on
hover and focus and keep errors until dismissed.

Verification:

- Component-test auto-dismissal with fake timers, pausing, error persistence,
  and stacking beyond three.

### 2.229 Terminal tab continuity

Status: planned
Blocked by: none

Switch terminal tabs instantly while preserving each tab's scroll position and
focus.

Verification:

- Component-test switching between tabs with scrollback and returning to the
  previous scroll position and focus.

### 2.230 Hover and press states

Status: planned
Blocked by: none

Use token-driven color changes for hover and press on every control, with no
press movement in dense rows.

Verification:

- Confirm each control class in Storybook has hover, press, focus, and
  disabled states, and that hover is absent under `(hover: none)`.

### 2.231 Desktop pointer and selection

Status: planned
Blocked by: none

Use the arrow cursor on controls and make application chrome unselectable
while transcript, code, paths, and errors stay selectable.

Verification:

- Component-test that a drag across the rail selects nothing and that
  transcript text remains copyable.

### 2.232 Increased contrast

Status: planned
Blocked by: none

Strengthen rules, muted text, and focus rings under `prefers-contrast: more`,
and use system colors under `forced-colors: active`.

Verification:

- Component-test computed rule width and focus ring width with each media
  query emulated.
- Check every shipped theme in Storybook.

### 2.279 Overlay dismissal

Status: planned
Blocked by: none

Close every dropdown, list, and details panel the same way: a pointer press
outside it, Escape, or a window blur closes it and returns focus to its
trigger. The model list ignores outside presses today because each overlay
handles dismissal itself. Move the shared behavior into one helper and use it
in Select, ModelPicker, ContextMeter, SessionPicker, and ContextMenu.

Verification:

- Component-test outside press, Escape, and focus return for each overlay,
  including a press on another overlay's trigger.
- Open the model list with a full provider list in the application shell at
  1440×900 and 900px, and screenshot it open and after an outside press.

### 2.280 Files view alignment

Status: planned
Blocked by: none

Line up the Files view on shared leading edges and center lines. Today the
"Files" label sits 5px right of the other rail headings, the view title and
the open file name start at different edges, and the editor actions read as
equal weight, with "Check for changes" heavier than Save. Save is the primary
action and Revert is secondary. Show folding chevrons only on lines that fold
a section, such as headings and lists, not on every paragraph.

Verification:

- Measure the rail headings, branch row, search field, and tree rows to one
  leading edge, and the open file name and editor actions to one center line.
- Screenshot the Files view in the application shell at 1440×900 and 900px
  with a long Markdown file, a clean file, an edited file, and no open file.
