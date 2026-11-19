# Product interface system

Pau is an operating interface for developers supervising agents and working in
local repositories. The interface should feel direct, calm, and technically
precise. It should not resemble an analytics dashboard or hide process state
behind decorative summaries.

This document owns durable visual and interaction decisions. Product behavior
comes from the [product specification](../product/README.md), and architecture
and implementation policy from the Technical plan in the project's issue
tracker.
[`apps/desktop/DESIGN.md`](../../apps/desktop/DESIGN.md) lists the token
values, and `apps/desktop/.impeccable/wireframes/` holds a static wireframe of
each surface. Where either disagrees with this document, this document wins.

The shell, the bay, the view row and the session view follow this document.
Every view shows the bay and the view row. Inside the main surface, Files,
Review, Terminal, Resources and Settings keep their previous content until
each moves to the Strip Bay. Code that disagrees with a rule here may predate
it.

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

The system is the Strip Bay: every session is a strip in a bay, racked by what
it needs from the operator. The window answers one question first: which
sessions need me?

The workbench is flat and dark, built from tonal layers on an 8px grid. Depth
comes from tone, and shadows belong to overlays. Every list of live things,
from sessions to tool calls, changed files, terminals and resources, uses the
same strip, so its fields line up on one baseline in every list. Small areas of
bright color mark what needs the operator, focus and state.

Pau is neither a three-pane IDE (file tree, tabbed editor, bottom panel) nor a
chat app. Transcript prose sits in a reading column, tool calls render as
inline strips, and the agent is never drawn as a person.

Avoid nested cards, floating glass surfaces, heavy shadows, ornamental terminal
motifs, and large dashboard metrics without an operator task.

## Layout regions

The wide shell has three columns:

- The bay, 344px, on the left. A filter field and New session sit at its top,
  the racked strips fill the middle, and the view row sits at its foot.
- The main surface, which keeps the largest useful width.
- The workspace column, 304px, on the right. It shows the open session's
  changes, branch, checks and terminals. It holds detail and never becomes a
  second navigation column.

A 32px status bar spans all three columns at the foot of the window in every
view, as [Status bar](#status-bar) describes.

A view without workspace detail, such as Settings, gives the workspace column
to the main surface. A view with its own sections, such as the Settings
sections, the Files tree or the terminal list, lists them in a 224px column
at the start of the main surface, beside the bay. The terminal dock is the only surface that splits the main
column.

Every column starts with a 48px header, so the three header rules form one
line across the window. The page header in the main surface holds the view
title, a status chip centered on the title line, and the view's actions at the
far end. A destructive action, such as Stop, sits apart from the others after
a rule.

### View row

Product navigation is the view row: one 32px quiet icon button per view across
the bay's foot: Sessions, Files, Review, Terminal, Resources and
Settings. The current view takes the selected treatment. Each button names its
view and shortcut in a tooltip on hover and on keyboard focus. A view that needs
a workspace stays disabled until one is open, and its tooltip gives the reason.
A view that is not ready yet stays visible and disabled with a "Coming soon"
tooltip.

### Status bar

The status bar answers what the open work costs the machine and what it runs
on. It is one 32px row on the bay surface under a 1px rule, set in the mono
metadata role in muted text. It holds state, not navigation, and nothing in it
is green.

Its leading group starts on the bay's `space/4` inset:

1. The workspace's branch, or its name outside Git, then its changed-file
   count and its sandbox state.
2. After a 1px rule, the open session's agent and version, context use,
   token total and cost, then the CPU, memory and process count of its agent
   and every process it started. Figures that are zero stay hidden. Without
   an open session it reads "No session".

At its trailing edge, a quiet button shows Pau's version and the CPU, memory
and process count of Pau and everything Pau started. The button fills the
bar's height with square corners, so the bar holds a 32px control without the
40px container the control rule asks for elsewhere. It opens an overlay above
itself that lists each running session as a strip, with its child processes
as row strips beneath it. Outside press and Escape close the overlay, and
focus returns to the button.

The bar follows the session in view. On another view it follows the session
last shown, and a workspace view drops a session from another workspace. The
backend samples resource use every two seconds while a window is connected,
and the figures change in place without motion.

### Breakpoints

- Wide, 1200px and up: bay, main surface and workspace column side by side.
- Narrow, 900 to 1199px: the bay narrows to 288px and hides the agent name on
  strips. The workspace column becomes an overlay that slides in from the
  right over a scrim. The header opens it, and the scrim or Escape closes it.
  It stays closed until the operator opens it, so new detail never covers the
  main surface. Section rails become tab rows. Buttons marked collapsible drop
  to their icon. An open terminal dock takes the whole main surface. The
  status bar keeps every item and drops words, as the Status bar brief in
  [surfaces](surfaces.md#status-bar) records.
- Below 900px is not a supported layout. The window keeps a 900px minimum
  width.

Do not scale the wide composition down. Recompose it.

The application shell fills the viewport and prevents document overscroll.
The bay, the main surface and the workspace column scroll independently, so
navigation and task context remain available with long content. Nested panes
contain their scroll instead of chaining it into the shell.

### Composer

The composer footer holds two groups: quiet options (delivery mode, model,
thinking, permission, context) and the actions. They share one row when both
fit. When they no longer fit, the actions keep the first row under the field
and the options wrap below them. In a narrow footer, the context meter shows
only the share used, and its details still list the window and token totals.
Completion lists open as a popover above the composer, so the composer keeps
its height and the transcript does not move.

While files are dragged over the composer, a drop target covers the
composer's own box and dashes its border: focus color when the drop would
attach images, danger color with the reason when it would not. The composer
and the status line keep their size and place.

The status line under the composer starts and ends on the composer's edges
and sets the folder, branch, and figures in the mono metadata role.
Figures that are still zero stay hidden. When space runs short, the path loses
its start first, the branch keeps its name up to a cap, the figures never
shrink, and extension statuses wrap to a second row.

## Spatial system

All spacing comes from the 8px grid. The scale uses 4, 8, 12, 16, 24, 32, 40,
48, and 64px steps, named `space/1` to `space/9`, where 4 and 12px are half
steps for control insets. The 40px step sets the height of section headings and
bars, 48px pads empty states, and 64px sets the composer input's minimum height
and the fade over collapsed tool output. Items inside a group sit 8px apart, and
distinct blocks in the transcript sit 24px apart. A value off the grid needs a
measured reason, such as the 6px descender padding in the cap-centring rule.

The spacing, type, radius, border, row, and column values have slash-separated
token names. `packages/ui/src/styles/tokens.css` records them as CSS custom
properties, so `space/3` becomes `--pau-space-3` and `size/row-md` becomes
`--pau-size-row-md`. Type sizes use `--pau-type-*` because `--pau-text` names
the text color.

Content in the bay, the workspace column, and a view that runs edge to edge
such as Files, starts `space/4` in from the column's edge. Bay headings,
section labels, the branch row, the search field, top-level tree rows, the
view title, and the bars under it share that leading edge. An edge-to-edge
view cancels the main surface's padding with the shell's own value at every
width, so it never overhangs the column.

- Desktop window: first opens at 1440×900, within 90% of the screen, and never
  narrower than 900px or shorter than 560px.
  Later launches restore the last size, position, and maximized state. If the
  saved position is off every connected display, the window opens centered at
  the first-launch size.
- Bay: 344px wide, 288px narrow.
- Workspace column: 304px.
- Column headers: 48px.
- Strips: 56px with two 24px lines. Rows and controls: 32px.
- Bay headings: 40px, so a label sits 16px below whatever is above it.
- Coarse-pointer targets: at least 44px even when the visible icon is smaller.

Pane boundaries and rows use 1px rules in the line token. Selected-row rings
stay stronger than structural rules. Depth runs ground, bay, raised, selected,
each one tint lighter. Reserve shadows for overlays that cover content, and for
a strip while it travels over other strips. Keep pane boundaries, rows, strips,
tabs, and attached controls square, so the bay reads as one rack. Controls,
chips, key caps, notices and cards use a 3px radius. Menus, popovers and
tooltips use 5px.

## Typography

Overpass Variable is the default interface face. Operators may select IBM
Plex Sans Variable, Inter Variable, Atkinson Hyperlegible Next Variable, or
Atkinson Hyperlegible Soft. Overpass Mono Variable is the default code face,
and operators may select JetBrains Mono or IBM Plex Mono instead. The code
face sets code, commands, paths, identifiers, counts and durations, with
ligatures off. Editable fields are the exception: a path or command typed
into a field stays in the interface face, so field text centers like every
other control. A font choice never changes a role's size, weight or line
height.

Every piece of text takes one of these roles. A surface never sets a size of
its own.

| Role       | Size | Line height | Weight | Use                                        |
| ---------- | ---- | ----------- | ------ | ------------------------------------------ |
| Title      | 18px | 24px        | 600    | The view or session title in the header    |
| Heading    | 16px | 24px        | 600    | Section titles and the permission question |
| Body       | 14px | 24px        | 400    | Transcript prose and descriptions          |
| Row        | 14px | 20px        | 400    | One-line rows and control text             |
| Strip name | 14px | 24px        | 500    | A strip's first line, 13px when mono       |
| State line | 13px | 24px        | 400    | A strip's second line                      |
| Meta       | 12px | 16px        | 400    | Agent names, figures, timestamps and chips |
| Label      | 11px | 16px        | 600    | Uppercase, 0.06em tracked section labels   |
| Code       | 12px | 20px        | 400    | Tool output, diffs and terminals, mono     |

Buttons use the row role at 500, and the primary at 600. Meta and labels use
muted text unless a state recolors them.

Every single-line label in a control or row sits in its own element, and that
element trims its box to the cap height and the baseline
(`text-box: trim-both cap alphabetic`). Flex centring then lines the capitals
up with icons, marks and checkboxes in every UI font. Input text cannot be
trimmed, so each UI face is loaded with ascent and descent overrides that put
its capitals in the middle of its line box. A field's text then centers on its
capitals with no per-font offset, and so does a label where `text-box` is
missing. A label that truncates gives its descenders back as 6px block
padding and takes the same space back as negative margin, so its centre does
not move.

- Set transcript prose, the composer, dialog and settings body text, and the
  primary text of list rows at 14px. The session header, transcript,
  composer, and status line share one column, at most 58rem wide, so they
  start and end on the same edges. Paragraph and list text in the transcript
  keeps a measure of 75ch from the column's left edge, so list items at every
  level end where paragraphs end. Code, tool output, diffs, and tables use
  the full column.
- In transcript lists, a bullet sits on the left edge of the surrounding
  text and item text starts `space/5` in. A number ends `space/2` before its
  item's text, so numbers line up on the period, and a list whose last number
  needs more room widens its indent.
- No product text goes below 12px, except the uppercase label role and key
  caps, which use 11px.
- Every main surface names its task with the title role (`pau-view-title`):
  the session title, Files, Processes, Diagnostics, MCP, Sandbox, the
  saved-session picker, and an empty state that fills the surface. A count or
  status chip beside the title centers on the title line.
- Labels that name a pane region, such as bay headings, "Search files", and
  "Queued", use the label role (`pau-section-label`). A bay or column heading
  always carries a mono count at its far end.
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
Vitesse Dark, in that order. Eldritch leads the dark themes and is the default.
Palette values come from their upstream projects and retain the required
attribution.

Green, the accent, means the operator is needed. It marks the Needs you
heading and count, the waiting mark and state line, the request card, the
activity dot on a background terminal, and the one primary action a surface
allows, such as Send prompt, Save or Allow once. A second green element on a
surface is a defect.

Cyan, the focus role, draws the focus ring, the text caret and the text
selection wash, and nothing else. Selecting a row, tab or view is neutral: the
selected surface plus a 1px ring in the control border token.

State colors live on marks and state lines, never on fills, row backgrounds or
titles. Every mark pairs its color with a shape (filled dot, spinning ring,
dashed ring, diamond, square) and a text label. Muted copy keeps AA contrast on
every surface.

A warning notice with rounded corners, such as the Pi readiness notice or a
resource browser warning, takes the warning tone on the whole box: a thin
warning border on every side, a light warning tint, and a warning icon when it
has one. A colored side border on a rounded box tapers at the corners, so a
rounded notice never uses one. The shared `pau-notice` rule in `packages/ui`
owns this treatment. A square-cornered notice, such as a session notice or a
keyboard shortcut note, may mark its tone with a colored side border.

## Components and controls

Use one control vocabulary across screens:

- primary button for the action that advances the current task;
- secondary button for alternatives;
- quiet or icon button for local utilities;
- the selected surface plus a control-strength ring for selected rows;
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
`pau-button` variants in `packages/ui` own these colors and the size.

Every button, field, picker and select is 32px tall (`row-md`) with 14px text
(`type-md`), in toolbars, rows, notices, cards and banners alike. A container
that holds a button is at least 40px tall. Components place and space controls
but do not resize them.
A button centers its label on the capitals, from cap height to baseline,
rather than on the font's line box, which sits higher or lower in each UI font.
An icon in a button centers on the same line. An icon, the label, a count,
and a key hint inside a button sit `space/2` apart.

The control that opens the workspace column at narrow widths belongs in the
page header. Keep task-specific actions in the task surface.

### Strip

The strip is the one fixed-height row for every list of live things:
sessions, tool calls, changed files, terminals, resources and menus. Its grid
is lead, main and meta.

- The 56px strip has two 24px lines, name and agent, then the state line and
  figures, led by an 8px mark.
- The icon strip leads with a 16px icon instead of a mark.
- The 32px row strip has one line.
- Hover moves to the raised surface. Selection, set with `aria-current` or
  `aria-selected`, takes the selected surface and the control-strength ring,
  and turns icons from muted to text color.
- Arrow keys step through the bay's strips.

### Bay

The bay racks session strips by what they need, in three sections, each under
a label and a mono count:

- Needs you: sessions with a pending dialog or permission request, failed
  sessions and sessions that stopped responding. A pending request racks a
  session here whatever status the agent reports. The label and count turn
  green. Its strips sit on the raised surface, separated by 1px rules in the
  bay color, and carry the only full-contrast names in the bay. State lines
  take their state color.
- Running: names step back to muted text at weight 500. The spinning mark and
  the mono state line keep the section ahead of Settled.
- Settled: idle and stopped sessions, with muted names at weight 400.

Only Needs you holds full contrast. Running and Settled recede through color
and weight, never through opacity, so their text keeps AA contrast on the bay.
The open session and a hovered strip return to text color in every section.

### Request card

The request card is the one green surface on a view: something waits on the
operator. The session's permission request and a resource's change preview
share it. It has a 1px accent border and a 6% accent wash over the raised
surface. Its head holds the waiting mark and the question in the heading role,
on a 15% accent band. Everything under the head hangs from the question's
leading edge. Its actions carry key caps, and Allow once is the primary. The
keys choose an action while focus is outside a text field. The card never
takes focus on its own, so a request that arrives mid-sentence never takes
the operator's typing. While Pau reconnects, the card stays visible and its
actions disable with a reason.

### Context menu

Sessions, workspaces, files, and transcript messages open a context menu on
right-click, `Shift+F10`, or the menu key. The menu is an in-app popover in the
top layer, not a native menu, so it uses the theme tokens, behaves the same in
the browser and the desktop app, and can show why an action is disabled. It
lists only actions the item supports. An action that is planned but not ready,
or that the item's state refuses, stays visible and disabled with its reason
underneath. Escape, Tab, or a choice closes the menu and returns focus to the
item. File menus can reveal a file in the system file manager but never launch
it in another application, because the webview renders agent-generated content.

### Select and pickers

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

### Transcript entries

Transcript entries start at the transcript's left edge, where assistant prose
and the session title start. Everything else in an entry starts on one inset,
`space/5` in from that edge: user message text, disclosure summaries, tool
bodies, the calls inside a tool group, and the text of a Markdown list item,
whose bullet, number, or task checkbox sits on the left edge. A left rule,
such as the user message bar or a tool row's line, counts toward the inset, so
the text does not move with the rule's width. Calls inside a group sit under
the group's rule with no further indent. Images sent with a prompt sit under
its text on the same inset, as the same square thumbnails the composer shows.
An image too large or damaged to show leaves a short muted line under the
prompt. An older image dropped to keep the transcript's images within its
memory budget leaves a dashed placeholder the size of a thumbnail, so the
content above the reader does not move. Thinking, tool rows, tool groups, and
compaction markers share one disclosure treatment from `disclosure.css`: a
right chevron centered in the inset that turns down while the entry is open,
muted summary text that turns to normal text on hover, and no native marker. A
failed tool row colors its chevron with the danger role.

### Status marks

Status marks in a row get a column as wide as the mark and sit `space/2` from
the label, in the bay as in the page header.

### Hover and press

Hover and press change color only. No control moves, scales, or resizes when
pressed, so a pressed row never shifts its neighbors. The shared rules in
`packages/ui/src/styles` own these states for each control class:

- Buttons: secondary, quiet, and danger buttons tint their fill and strengthen
  the border on hover, and tint further on press. The primary moves its accent
  toward the text color, a quarter on hover and nearly half on press.
- Utility buttons (`pau-utility-button`), such as view row icons, toolbar
  icons, and Copy: muted rest, normal text and a tint on hover, a stronger tint on
  press.
- Rows (`pau-row`): strips, tree rows, tabs, result rows, and completion
  options use the same tints and turn muted text to normal text. A selected
  row keeps its selection fill under the pointer.
- Popover options (`pau-option`) on the raised surface take the selection fill
  on hover, as keyboard movement shows it, and step down to the surface on
  press.
- Fields (`pau-field`), including dropdown triggers, step up to the strong
  border on hover, and triggers tint on press. The composer's quiet triggers
  lift to the raised surface instead. Green stays off fields, because it
  marks only what needs the operator.
- Choice rows move the native input's text-colored fill toward muted text,
  disclosure summaries lift to normal text and tint on press, and links move
  the accent toward text.

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
otherwise push the gap off the spacing scale. The input is one `em` square and
centers on the capitals of its label's first line, as button labels do. Text
fields and settings panels draw their edges with the theme border token.

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
input, and never moves content the operator is reading. The system has one
authored moment, the arrival. Everything else is feedback.

### Arrival

When a running session starts waiting on the operator, its strip lifts out of
Running and travels to the top of Needs you.

- The strip's mark, state line and section counts change first, so the new
  state reads before the strip moves.
- The travel takes 640ms from the strip's visible place. Over the first 15%,
  the strip lifts 4px, takes the lift shadow and moves from the bay to the
  raised surface. It moves on `ease-out` and settles on `ease-settle`.
- The strips and headings it passes slide aside over 480ms on the same
  ease-out, after a 90ms delay.
- Under reduced motion, the strip changes place at once and its band fades in
  over 100ms.

The attention marker does not pulse, and nothing else in the system travels.

### Tokens

`packages/ui/src/styles/tokens.css` defines theme-independent motion tokens
next to the scale tokens. `packages/ui/src/motion.ts` exports the same values
for Svelte transitions, and a contract test keeps the two in sync. No
component uses a literal duration or easing keyword.

| Token              | Value                           | Use                                       |
| ------------------ | ------------------------------- | ----------------------------------------- |
| `duration-quick`   | 120ms                           | Hover, press, selection and state color   |
| `duration-move`    | 240ms                           | Overlays, menus, dialogs and disclosures  |
| `arrival-travel`   | 640ms                           | The arrival                               |
| `arrival-displace` | 480ms after a 90ms delay        | Strips the arrival passes                 |
| `mark-spin`        | 900ms per turn, linear          | The running mark only                     |
| `ease-out`         | `cubic-bezier(0.16, 1, 0.3, 1)` | Every transition and the arrival's travel |
| `ease-settle`      | `cubic-bezier(0.2, 0, 0, 1)`    | The arrival's lift and settle             |

The root element's `data-motion` attribute collapses movement distances to
zero under reduced motion, so a slide becomes a fade.

`busyIndicatorTiming` in `motion.ts` holds the busy-indicator timing: show
after 400ms and stay visible for at least 500ms. `BusyIndicator` in
`packages/ui` applies it. While a shown indicator waits out its 500ms, the
content that replaces it waits too, and a `role="status"` indicator renders
only once shown, so screen readers announce what sighted operators see.
Indicators for an operation already visible in progress, such as a running
tool row or session status, are not delayed.

### Rules by component class

| Component                   | Enter                            | Exit    | Notes                        |
| --------------------------- | -------------------------------- | ------- | ---------------------------- |
| Hover and press             | quick, color only                | quick   | Instant in dense lists       |
| Focus ring                  | instant                          | instant | Never transition `outline`   |
| Selection                   | quick, color                     | quick   | No sliding indicator         |
| Session status              | quick, color                     | quick   | One spinner only for running |
| Strip entering Needs you    | the arrival                      | instant | Fade only when reduced       |
| Disclosure (tool, thinking) | move, rows 0fr to 1fr            | quick   | Instant if streaming or tall |
| Popover, menu (pointer)     | move, fade                       | quick   | Origin at the anchor         |
| Completion list (keyboard)  | instant                          | instant |                              |
| Command palette             | instant, quick fade from pointer | instant | No fade under reduced motion |
| Dialog                      | move, fade                       | quick   | Backdrop fades with it       |
| Narrow workspace overlay    | move, slide from the right       | quick   | Scrim fades with it          |
| Task-surface change         | instant                          | instant | No cross-fade between views  |
| Terminal tab                | instant                          | instant | Never animate the canvas     |
| Diff hunk update            | 1s background tint fade          | —       | Static marker when reduced   |
| Transcript streaming        | none                             | —       | Append per frame, no fades   |
| Follow-mode scroll          | jump                             | —       | No smooth scrolling          |

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
`isReducedMotion()` from `motion.ts`. The Motion setting in Appearance (System,
Reduce or Full) writes the attribute. Storybook's reduced-motion control sets
it directly.

Under reduced motion:

- Movement distances collapse, so movement becomes a fade.
- The arrival becomes an instant move and a 100ms fade.
- Opacity and color feedback stays at `duration-quick` or less.
- The running mark stops spinning and shows a static ring.
- Svelte transitions read the shared motion setting and drop movement.
- Smooth scrolling is off.

### Focus ring

Every focusable control draws the same ring: `--pau-focus-width` (2px) in
`--pau-focus`, offset by `--pau-focus-offset` (2px) outside the control. Inside
scroll containers, edge-to-edge rows, and the workspace overlay, where an
outset ring would be clipped, use `--pau-focus-offset-inset` (-2px) so the ring stays
inside the control. Controls that draw focus another way, such as the pane
resizer's separator line, use the same color and width.

### Increased contrast

Under `prefers-contrast: more`, rules take the strong border token, muted text
moves toward normal text, and `--pau-focus-width` becomes 3px. Under
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

- starting, idle, running, waiting, not responding, stopping, stopped, and
  failed sessions;
- disconnected UI with surviving native work;
- loading, empty, error, success, disabled, and permission states;
- long paths, session names, output, and translated labels;
- partial replay or bounded history where relevant.

## Verification

Inspect each changed composition at desktop and narrow widths. Check hierarchy,
overflow, focus, keyboard operation, coarse-pointer targets, reduced motion,
long content, and the most important alternate state. Screenshot fixtures record
compositions, but behavior checks must verify controls.
