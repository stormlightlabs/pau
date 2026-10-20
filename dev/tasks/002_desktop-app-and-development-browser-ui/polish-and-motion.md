# 2. Desktop app: Polish and motion

## Polish and motion

### 2.235 Typography scale and Overpass

Status: in progress
Status note: Implemented and tested. The visual review in each theme at 1440
and 900px remains.
Blocked by: none

Make Overpass Variable the default UI font and Overpass Mono the code font,
both bundled from Fontsource. Keep IBM Plex Sans as a selectable UI font and
drop IBM Plex Mono. Adopt this starting scale:

| Element                              | Size    | Weight |
| ------------------------------------ | ------- | ------ |
| Main task heading                    | 18px    | 600    |
| Application body                     | 14px    | 400    |
| Workspace names and inspector values | 13px    | 500    |
| Commands, paths, and metadata        | 12–13px | 400    |
| Section labels                       | 11px    | 600    |

Replace the 20px step with 18px, add weight tokens for 400, 500, and 600, and
fold ad hoc 650 and 700 weights into 600. Allow 11px only for uppercase,
letter-spaced section labels, and record that exception where the 12px floor
is stated. Move body text that sits at 12px today to 14px, and leave true
metadata at 12–13px. Update `dev/design/system.md` and the prototype styles
and pages together. 2.236 carries the change into `pau.fig`.

Verification:

- Component-test that the default preference resolves to Overpass, that IBM
  Plex Sans remains selectable, and that code uses Overpass Mono.
- Confirm no product text other than section labels renders below 12px.
- Review the session view, inspector, Diagnostics, and an overlay in each
  shipped theme at 1440 and 900px widths.

### 2.236 Design file cleanup

Status: planned
Blocked by: 2.235

Bring `pau.fig` back in line with `dev/design` and the prototype pages. Until
this unit is complete, the prototype HTML pages are the current visual
reference wherever the two disagree.

- Fix overlapping and clipped text in every frame.
- Delete the components left from the old prototype site chrome, including
  the workbench sidebar, page header, and hub card, and rebuild the `index`
  page without them.
- Rebuild screens from the shared components and bind colors, type, spacing,
  and radii to the token variables.
- Apply the Overpass fonts and the type scale from 2.235.
- Add the pending and "Not sent" prompt states to the session frames.
- Update `dev/prototype/README.md` to match the file.

Verification:

- Run the OpenPencil lint and overlap analysis on every page and fix each
  finding.
- Compare each frame's structure and copy against its HTML page.

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

### 2.269 Composer footer fit and completion overlays

Status: planned
Blocked by: none

Keep the composer footer on one row at 1440×900 with the context rail open and
model controls shown. At narrow widths, keep the actions on the first row and
wrap the quiet controls below them. Show `/` and `@` completion lists as a
popover above the field so the transcript does not move.

Verification:

- Measure one shared center line for every footer control at 1440×900, at most
  two footer rows at 800×560 with Send prompt on the first, and an unchanged
  transcript position while a completion list is open.

### 2.270 Transcript and session rail rhythm

Status: planned
Blocked by: 2.269

Give the session rail status mark the same column and gap as the header mark.
Use one disclosure treatment, a chevron with a hover state, for thinking, tool
rows, and tool groups. Put message text, tool labels, tool bodies, and group
summaries on one leading edge. Size the rail buttons alike, and make the
attached image's Remove a quiet button.

Verification:

- Measure the shared leading edge and the 8px mark gap, and screenshot a tool
  row hover and expanded tool groups.

### 2.271 Metadata separators everywhere

Status: planned
Blocked by: none

Render every metadata join with `MetaText` instead of a literal `·`,
including tool outcomes, read ranges, file tree labels, and diagnostics text.

Verification:

- Confirm no literal separator joins remain outside `MetaText`, and measure
  equal space on both sides of the dot in a shell command outcome.

### 2.272 Shell chrome states and rows

Status: planned
Blocked by: none

Keep the inspector closed below the docked width until the operator opens it,
instead of opening it over the transcript when a session has resource data.
Make product rail hover distinct from the active item, size context rail rows
like the other rail rows, and keep main content padding on the spacing scale.

Verification:

- At 900px wide, a session with resource data shows the transcript with no
  backdrop until the inspector toggle is pressed. Measure 32px context rail
  rows and padding on the spacing scale, and screenshot product rail hover.

### 2.273 Product tokens in settings views

Status: planned
Blocked by: none

Replace the Storybook-only `--workbench-*` colors in the sandbox, MCP, and
capability views with product tokens, so their borders and surfaces show in the
app. Size the sandbox view by its container instead of the viewport. Give radio
and checkbox rows one shared label gap.

Verification:

- Confirm no `--workbench-*` reference remains outside Storybook, field borders
  compute to the theme border, the sandbox route has no horizontal overflow at
  800×560, and choice labels sit 8px from their inputs.

### 2.274 Processes view in the application shell

Status: planned
Blocked by: none

Show the processes route inside the application shell with product navigation
and live process data, and let its table recompose below its container width
instead of forcing a minimum width.

Verification:

- Screenshot the route with the product rail and top bar, and measure no
  horizontal overflow at 800×560 with Stop inside the main surface.

### 2.275 One control size for buttons and menus

Status: planned
Blocked by: 2.273

Remove per-view button size overrides so view actions use the shared button
styles, with at most one documented compact size. Use focus tokens for the
context menu's focus ring.

Verification:

- Measure every view action button at the shared height, and the context menu
  outline at the focus width token.

### 2.276 View titles, headings, and leading edges

Status: planned
Blocked by: 2.273

Use one view title role for Files, Processes, Diagnostics, MCP, and Sandbox.
Give Markdown headings a descending scale. Align the saved-session picker,
editor blocked states, and route-level controls to the leading edge of the
view content.

Verification:

- Measure the same title size on every main surface, Markdown h1 larger than h2
  larger than h3, and shared leading edges for the picker, editor states, and
  route controls.

### 2.277 Dropdown error placement

Status: planned
Blocked by: none

Anchor a rejected choice's message to the dropdown trigger and keep it inside
the window, for the shared dropdown and the model and thinking pickers.

Verification:

- Measure the message inside the window at 600 and 1440 wide in each rejected
  state, and inside the main surface for the composer's thinking picker at
  800×560.
