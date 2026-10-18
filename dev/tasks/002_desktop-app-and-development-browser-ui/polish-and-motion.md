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

### 2.246 Metadata separator spacing

Status: planned
Blocked by: none

Overpass sets the middle dot with almost no right side bearing, so every
`a · b` label renders as "Pi ·Sonnet", "You ·task", "prompt ·interrupt",
"2 shown ·12 expired", "project ·stdio", and "Context 164k / 200k ·82%". The
prototype pages show the same gap. Replace the literal `·` in the session
header, message labels, tool call paths, Diagnostics, Processes, MCP sources,
the context meter, the resource summary, and the file rail with one shared
separator element that carries equal spacing on both sides, and apply the same
rule in `dev/prototype/styles/app.css`.

Verification:

- Component-test that the session header, a tool call path, and a Diagnostics
  adapter row render the separator element instead of a middle dot in text.
- Screenshot the session header in Overpass and IBM Plex Sans and confirm
  equal spacing on both sides.

### 2.247 Composer action row

Status: planned
Blocked by: none

The composer places Attach image, Interrupt, and Send prompt beside the text
field and wraps them only below 40rem, so at 1200px with the inspector open
and at 900px the field shrinks to about 130px and the placeholder wraps to
three clipped lines. Put the delivery-mode select and the action buttons in one
row below the field at every width, as the prototype session page does, keep
the field full width, and draw the focus ring on the field instead of around
the whole composer.

Verification:

- Component-test at 900px and 1440px that the field spans the composer width
  and the placeholder stays on one line.
- Check in Storybook that Send prompt and the delivery mode stay reachable at
  360px.

### 2.248 Composer footer controls

Status: planned
Blocked by: 2.247

The model picker, thinking level picker, and context meter render in the
session header beside Compact and Stop, which crowds the title row when Pi
reports models. Move them into the composer footer row with the delivery mode,
as `screens-session-default.html` shows, so the header holds only the title,
status, and session actions.

Verification:

- Component-test that the pickers and meter render in the composer footer and
  keep their keyboard behavior.
- Screenshot the running session at 900px and 1440px and confirm the footer
  wraps without hiding Send prompt.

### 2.249 Session header actions

Status: planned
Blocked by: none

The header shows Compact, then the status label, then Stop, and the status
label's width moves the buttons by up to 80px between Starting, Running,
Ready, and Needs you. While compacting, the Compact button reads
"Compacting…" but the status still says Ready. Order the header as status
with a fixed-width slot and elapsed time first, then Compact and Stop as quiet
buttons, and reflect compaction in the status label.

Verification:

- Component-test that the Stop button's position is the same across the
  running, idle, waiting, and compacting fixtures.
- Screenshot the header in each session state at 1440px.

### 2.250 Primary action consistency

Status: planned
Blocked by: none

Open, Start session, Try again, New session, Resume, Open terminal, and Reload
from disk use the secondary style while Open a terminal, Send prompt, Save
workspace default, and Enable for this workspace use the accent primary. The
disabled primary (Save with no changes, Open a terminal while disconnected) is
a dim green that still reads as enabled. Give each surface one accent primary
for the action that advances the task and use the muted surface and disabled
text token for disabled primaries.

Verification:

- List each surface's primary action in the unit's pull request and confirm
  Storybook shows exactly one accent button per surface.
- Component-test that a disabled primary uses the disabled text color.

### 2.251 Empty-state alignment

Status: planned
Blocked by: none

Session empty states ("No session selected", "Loading sessions…", "Open a
folder") start 160px right of the transcript column, the "Start with a prompt"
placeholder starts 280px right of it, and the Files, editor, and Processes
empty states center vertically. Align every empty state to the task surface's
content column, top-aligned, with the same heading, body, and action stack.

Verification:

- Component-test that the empty-state heading's left edge equals the
  transcript column's left edge in the session view.
- Screenshot the session, Files, editor, terminal, and Processes empty states
  at 1440px and 900px.

### 2.252 Session rail rows

Status: planned
Blocked by: none

Session rows sit on a 48px pitch with 12px of canvas between them, the
selected surface stops short of the rail edges, "No workspaces yet" is
indented 16px past the workspace names, and the add and history icon buttons
have no resting treatment. Make rows contiguous at `size/row-md` with the
selected surface spanning the rail and a left-edge indicator, align the empty
copy with the workspace name, and give the icon buttons the quiet-button
resting style with a 44px hit area.

Verification:

- Component-test that consecutive session rows have no gap and that the
  selected row spans the rail width.
- Screenshot the concurrent-sessions fixture at 1440px and 900px.

### 2.253 Rail name truncation

Status: planned
Blocked by: none

Dragging the context rail to its 160px minimum wraps workspace names across
three lines ("fix-", "diff-", "gutter") and pushes the status text out of
line. Truncate names with an ellipsis, keep the status on the same line, and
keep the full name in the accessible label and tooltip.

Verification:

- Component-test that a long name at the minimum rail width renders one line
  with an ellipsis and keeps its full accessible name.

### 2.257 State labels and copy

Status: planned
Blocked by: none

Several labels misuse color or case: "Pau-managed MCP off" is danger red for a
neutral state, "Minimum log level" is link blue, "Not Connected" is title case
beside "Connected", "Sandbox on" and "Diagnostics mode on" are two styles of
mode indicator, and the readiness notice breaks its install command inside
"pi-coding-agent". Use muted text for off states, normal text for labels,
sentence case, one outlined chip for mode indicators, and keep commands on one
line with horizontal scrolling.

Verification:

- Component-test that the MCP off label uses the muted text color and that
  the command block does not wrap.
- Screenshot the MCP, Diagnostics, sandbox, and readiness fixtures.

### 2.258 View header insets

Status: planned
Blocked by: none

The Diagnostics and Processes headers start at the pane's left edge and their
right-side count or chip touches the right edge while every section below is
inset. Give the shared view header the same horizontal padding as its sections
and align the right-side metadata with the section's right edge.

Verification:

- Component-test that the header's left padding equals the first section's
  left padding in both views.
- Screenshot both views at 1440px and 900px.

### 2.259 Diagnostics narrow layout

Status: planned
Blocked by: none

At a 900px window the Diagnostics records truncate their metadata
("sequence=842 · rep…") and the transport rows stay a six-column table,
although `surfaces.md` says records stack without truncation and transport
rows become labelled metric blocks at narrow widths. Apply the narrow layout
when the main column is under 48rem and wrap record metadata.

Verification:

- Component-test that no record metadata is clipped at a 600px main column
  and that transport rows render as metric blocks.

### 2.260 File rail status rows

Status: planned
Blocked by: none

Changed-file rows truncate paths from the end ("packages/ui/src/l…"), which
hides the file name, and set them in bold mono while tree rows use regular
weight. "Search files" is mixed case between uppercase section labels, and the
search, filter, and tree blocks use different vertical padding. Show the file
name with the directory muted and truncated at its start, use regular weight,
make "Search files" a section label, and pad the three blocks with `space/3`.

Verification:

- Component-test that a long changed path keeps its file name visible.
- Screenshot the file tree fixture at 1440px and 900px.

### 2.261 Editor error actions

Status: planned
Blocked by: none

Binary and oversized files show a "Try again" button that cannot succeed.
Replace it with "Reveal in file manager" and, when the preferred editor
setting exists, "Open in external editor", and state the size limit or the
binary detection in the message.

Verification:

- Component-test that the binary and oversized states render the reveal
  action and no retry.

### 2.262 Tool call rows

Status: planned
Blocked by: none

Each finished tool call renders "Complete" in its right column and its result
summary on a second line, so a four-call turn takes eight rows. The prototype
shows the summary ("248 lines", "42 passed", "+18 −7") in the right column,
one row per call, under a collapsible group row ("3 tool calls · 12s"). Move
the summary into the right column, show the status text only while running
or after a failure, and collapse groups of more than three finished calls
behind a summary row.

Verification:

- Component-test that a finished call renders one row with its summary at
  the right and that four finished calls collapse behind a group row.
- Screenshot the running fixture before and after the change.

### 2.263 Picker triggers

Status: planned
Blocked by: none

The model picker trigger has no chevron, its list has no check mark, and the
list opens to the left of the trigger, while the thinking level picker and
`Select` use the field style with a chevron and a check mark. `system.md` says
the model picker uses the Select surface. Give the model picker and the
context meter trigger the Select field style and align their lists with the
trigger's edge.

Verification:

- Component-test that the model picker trigger renders the chevron and that
  the current model row renders the check mark.
- Screenshot the model picker, thinking level picker, and context meter open.

### 2.264 Resource pressure actions

Status: planned
Blocked by: none

The inspector's sustained-pressure card renders "Interrupt work" and "Stop
session" as filled yellow and red buttons with dark text, while Processes and
MCP render Stop and Remove server as outlined buttons with danger text. Use the
outlined secondary style with warning and danger text in the card.

Verification:

- Screenshot the resource pressure fixture in each shipped theme and confirm
  the buttons match the Processes Stop button.

### 2.265 Storybook theme for shell demos

Status: planned
Blocked by: none

`ApplicationShell` applies its `theme` prop and ignores the Storybook theme
toolbar, so the session view, Files, terminal, and shell stories render
Eldritch under every global, and the shell stories default `uiFont` to Inter.
Pass the global theme and UI font through each demo so the toolbar reviews
every surface in every theme.

Verification:

- Confirm in Storybook that switching the theme toolbar recolors the session
  view, Files, and terminal stories.

### 2.266 Prototype launch pages

Status: planned
Blocked by: none

`splash-launch-*.html` show a percentage progress bar, which contradicts the
Launch brief in `surfaces.md` ("avoid fake percentages") and the step list the
app's `LaunchSplash` renders. Replace the bar with the step list, including a
failed step's reason and the Copy action, and note the change in
`dev/prototype/README.md`.

Verification:

- Open each launch page and confirm it shows the step list with the same
  states as the `LaunchSplash` stories.

### 2.267 Command palette initial highlight

Status: planned
Blocked by: none

The palette opens with "Show keyboard shortcuts" highlighted even when that
row is marked "Not available in this view", so Enter does nothing. Highlight
the first available action and list unavailable actions after available ones
within a group.

Verification:

- Component-test that the initial highlight is an available action and that
  Enter runs it.
