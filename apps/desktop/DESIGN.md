---
name: Pau
description: An IDE and session orchestrator that racks concurrent coding agents by what they need from you.
colors:
  ground: '#12151d'
  bay: '#171b27'
  raised: '#202536'
  selected: '#2a3045'
  overlay: '#232839'
  text: '#e6e9f2'
  text-muted: '#9aa3bd'
  text-disabled: '#7d849c'
  text-on-accent: '#07140d'
  line: '#293044'
  line-control: '#6b7089'
  line-strong: '#8b91a8'
  accent: '#38ef9d'
  focus: '#04d1f9'
  success: '#57e69a'
  warning: '#f5bf69'
  danger: '#ee7180'
  info: '#43c7e8'
  purple: '#a48cf2'
typography:
  title:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '18px'
    fontWeight: 600
    lineHeight: '24px'
    letterSpacing: '-0.01em'
  heading:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    lineHeight: '24px'
  body:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '24px'
  row:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '20px'
  strip-name:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '14px'
    fontWeight: 500
    lineHeight: '24px'
  meta:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '16px'
  label:
    fontFamily: 'Overpass, ui-sans-serif, sans-serif'
    fontSize: '11px'
    fontWeight: 600
    lineHeight: '16px'
    letterSpacing: '0.06em'
  code:
    fontFamily: 'Overpass Mono, ui-monospace, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '20px'
    fontFeature: "'liga' 0, 'calt' 0"
rounded:
  control: '3px'
  overlay: '5px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '24px'
  '6': '32px'
  '7': '40px'
  '8': '48px'
  '9': '64px'
components:
  button:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: '0 12px'
    height: '32px'
  button-hover:
    backgroundColor: '{colors.selected}'
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.text-on-accent}'
    rounded: '{rounded.control}'
    padding: '0 12px'
    height: '32px'
  button-primary-disabled:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text-muted}'
  button-quiet:
    textColor: '{colors.text-muted}'
    rounded: '{rounded.control}'
    padding: '0 12px'
    height: '32px'
  button-quiet-hover:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
  button-danger:
    textColor: '{colors.danger}'
    rounded: '{rounded.control}'
    padding: '0 12px'
    height: '32px'
  button-icon:
    rounded: '{rounded.control}'
    size: '32px'
  field:
    backgroundColor: '{colors.ground}'
    textColor: '{colors.text}'
    typography: '{typography.row}'
    rounded: '{rounded.control}'
    padding: '0 8px 0 12px'
    height: '32px'
  strip:
    textColor: '{colors.text-muted}'
    typography: '{typography.strip-name}'
    padding: '4px 16px'
    height: '56px'
  strip-hover:
    backgroundColor: '{colors.raised}'
  strip-selected:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.text}'
  strip-attention:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
  strip-row:
    typography: '{typography.row}'
    padding: '0 16px'
    height: '32px'
  bay-heading:
    textColor: '{colors.text-muted}'
    typography: '{typography.label}'
    padding: '16px 16px 0'
    height: '40px'
  bay-heading-attention:
    textColor: '{colors.accent}'
  chip:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text-muted}'
    typography: '{typography.meta}'
    rounded: '{rounded.control}'
    padding: '0 8px'
    height: '20px'
  badge:
    textColor: '{colors.text-muted}'
    rounded: '{rounded.control}'
    padding: '0 6px'
    height: '18px'
  ask:
    textColor: '{colors.text}'
    typography: '{typography.heading}'
    rounded: '{rounded.control}'
    padding: '0 16px 16px'
  notice:
    backgroundColor: '{colors.raised}'
    typography: '{typography.row}'
    rounded: '{rounded.control}'
    padding: '12px 16px'
  menu:
    backgroundColor: '{colors.overlay}'
    rounded: '{rounded.overlay}'
    padding: '4px'
    width: '240px'
  bay:
    backgroundColor: '{colors.bay}'
    width: '344px'
  workspace:
    backgroundColor: '{colors.bay}'
    width: '304px'
  header:
    height: '48px'
---

# Design System: Pau

## Overview

**Creative North Star: "The Strip Bay"**

Every session is a strip in a bay, racked by what it needs from you. The
developer runs many Pi and Claude Code sessions at once, keyboard first, for
long stretches at a desk. The window answers one question before any other:
which sessions need me? A 344px bay on the left holds every session as a
fixed-height strip, sorted into Needs you, Running and Settled. The open
session fills the centre. A 304px workspace column on the right shows its
changes, branch and terminal.

The system is Eldritch at shell scale: a blue-slate ground, the bay one tonal
step above it, and green spent only where it means something. The surfaces
are flat. Depth comes from tone, and shadows belong to overlays. Density is
high and regular: one 8px construction grid sets every strip, column and
gutter, and every list of live things shares one strip shape, so fields line
up on one baseline across the bay, tool calls, changed files, terminals and
resources.

The world refuses two things by name: the three-pane IDE (file tree left,
tabbed editor, bottom panel) and the chat app (bubbles, the agent drawn as a
person). Transcript prose sits in a 75ch column, tool calls render as inline
strips, and a permission request is the focal point of the view.

**Key Characteristics:**

- Sessions racked by attention, with Needs you as the only lifted green band
- Fixed-height strips with the same fields on one baseline in every list
- Flat tonal layers on an 8px grid, with shadows only on overlays
- Overpass at a fixed scale with cap-centred controls, Overpass Mono for
  paths, numbers and durations
- Green on what needs you and on one primary action per surface, cyan on
  focus only

## Colors

A dark blue-slate palette from eldritch.nvim, with one green accent and state
colours confined to marks and state lines.

### Primary

- **Eldritch Green** (`accent`): what needs the developer. It marks the
  Needs you heading and count, the waiting mark, the waiting state line, the
  permission card's edge and wash, the activity dot on a background terminal,
  and the one primary button a surface may have. Text on it uses
  **Green Ink** (`text-on-accent`).

### Secondary

- **Eldritch Cyan** (`focus`): keyboard focus, the text caret and the text
  selection wash. Nothing else.

### Tertiary

- **State colours**: **Success Green** (`success`) for passed checks and
  added lines, **Amber** (`warning`) for not responding and stopping,
  **Rose** (`danger`) for failed, removed lines and the Stop action,
  **Sky** (`info`) for running and starting, and **Violet** (`purple`) for
  syntax keywords and the shell prompt sign.

### Neutral

- **Blue-Slate Ground** (`ground`): the window, the transcript, text fields
  and the terminal peek.
- **Bay Slate** (`bay`): the bay and workspace columns, one step above the
  ground.
- **Raised Slate** (`raised`): buttons, chips, notices, hovered strips and
  the Needs you strips.
- **Selected Slate** (`selected`): the open session, the current tab and the
  current view, always paired with a 1px `line-control` ring.
- **Overlay Slate** (`overlay`): menus, popovers and tooltips.
- **Paper White** (`text`), **Mist** (`text-muted`) and **Ash**
  (`text-disabled`): primary text, secondary text and disabled labels.
- **Pane Rule** (`line`): rules between panes and rows.
- **Control Edge** (`line-control`) and **Strong Edge** (`line-strong`):
  control borders at 3:1 or better on every surface, and their hover and
  on-green step.

Syntax roles and the terminal's ANSI set derive from the same palette and are
listed in the sidecar. The values above are Eldritch, which leads the dark
themes. Nord, Iceberg, Catppuccin Mocha and Vitesse Dark map the same roles.

### Named Rules

**The Needs You Rule.** Green means the developer is needed. It appears on
what waits for them and on the one primary action a surface allows, such as
Save, Start a session or Allow once. A second green element on a surface is a
defect.

**The Marks Only Rule.** State colours live on marks and state lines, never
on fills, row backgrounds or titles. Every mark pairs its colour with a shape
(filled dot, spinning ring, dashed ring, diamond, square) and a text label.

**The Cyan Is Focus Rule.** Cyan draws the focus ring, the caret and the
selection wash. Selection of a row or tab is neutral: the selected surface
plus a control-strength ring.

## Typography

**UI Font:** Overpass (with ui-sans-serif, sans-serif)
**Mono Font:** Overpass Mono (with ui-monospace, monospace)

**Character:** One family in two cuts. Overpass carries every label and line
of prose. Overpass Mono, with ligatures off, carries code, commands, paths,
identifiers, counts and durations, so `--filter` keeps its cells.

Overpass and Overpass Mono are the defaults. Settings offers IBM Plex Sans,
Inter, Atkinson Hyperlegible Next and Atkinson Hyperlegible Soft for the
interface, and JetBrains Mono and IBM Plex Mono for code. A font choice never
changes a role's size, weight or line height.

### Hierarchy

- **Title** (600, 18px, 24px): the session or page title in the header.
- **Heading** (600, 16px, 24px): section titles and the permission question.
- **Body** (400, 14px, 24px): transcript prose and descriptions, held to a
  75ch measure.
- **Row** (400, 14px, 20px): one-line rows and control text. Buttons use 14px
  at 500, the primary at 600.
- **Strip name** (500, 14px, 24px): the first line of a strip. Mono names
  drop to 13px. The state line is 13px on the same 24px line.
- **Meta** (400, 12px, 16px, Mist): agent names, figures, timestamps and
  chips.
- **Label** (600, 11px, 0.06em, uppercase, Mist): bay and column section
  headings such as NEEDS YOU, always with a mono count at the far end.
- **Code** (Overpass Mono 400, 12px, 20px): tool output, diffs and the
  terminal peek. Numbers everywhere are tabular.

### Named Rules

**The Fixed Scale Rule.** A surface picks one of the roles above and never a
size of its own. No text goes below 12px except the uppercase section label
and key caps (11px).

**The Cap-Centring Rule.** Every single-line label in a control or row sits
in its own element, and that element trims its box to the cap height and the
baseline (`text-box: trim-both cap alphabetic`). Flex centring then lines the
capitals up with icons and marks. Where `text-box` is missing, the label
moves down by the measured Overpass offset (0.11em). A label that truncates
gives its descenders back as 6px block padding and takes the same space back
as negative margin, so its centre does not move.

**The Mono Means Data Rule.** Mono marks something the machine owns: a path,
a command, a number, a duration. It is never decoration.

## Layout

The shell is three columns: the bay (344px), the main surface, and the
workspace column (304px). Every column header is 48px tall, so the three
header rules form one line across the window. The bay stacks a filter field
and New session on top, the racked strips in the middle, and a row of view
buttons at its foot. Views without workspace detail give that column to the
main surface.

In the main surface, header, transcript and composer share one leading edge
inside a column of at most 58rem plus 24px gutters. Prose holds to 75ch. The
transcript scrolls from its end, and the composer docks under it.

All spacing comes from the 8px grid (4px and 12px are half steps for control
insets). Strips are 56px, rows and controls 32px, bay headings 40px, so a
label sits 16px below whatever is above it. Inside a group, items sit 8px
apart. Distinct blocks in the transcript sit 24px apart.

### Breakpoints

- **Wide, 1200px and up:** bay, main and workspace side by side.
- **Narrow, 900px to 1199px:** the bay narrows to 288px and hides the agent
  name on strips. The workspace column becomes an overlay that slides in from
  the right over a scrim, opened from the header and closed by the scrim or
  Escape. Section rails become tab strips. Buttons marked collapsible drop to
  their icon. An open terminal dock takes the whole main surface.
- **Below 900px:** not a supported layout. The shell holds a 900px minimum.

### Named Rules

**The One Grid Rule.** Every strip, column and gutter lands on the 8px grid.
A value off the grid needs a measured reason, such as the 6px descender
padding.

**The 32px Control Rule.** Every button, field, picker and select is 32px
tall with 14px text, in toolbars, rows, notices, cards and banners alike. A
container that holds a button is at least 40px tall.

## Elevation & Depth

The system is flat and tonal. Depth runs ground, bay, raised, selected: each
step is one tint lighter, and the Needs you strips sit on the raised step
inside the bay. The permission card gains focal depth without a shadow: a
green-washed head band one tint above the card body, under a full-strength
accent edge.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 12px 32px -8px rgb(4 6 12 / 0.72), 0 2px 6px rgb(4 6 12 / 0.4)`):
  menus, popovers, tooltips and the narrow workspace overlay.
- **Lift** (`box-shadow: 0 12px 24px -8px rgb(4 6 12 / 0.72), 0 2px 6px rgb(4 6 12 / 0.4)`):
  a strip in flight during the arrival motion, only while it passes over
  other strips.

### Named Rules

**The Shadows Cover Rule.** A shadow means something covers other content.
Resting surfaces never carry one.

## Shapes

Rows, strips and pane edges are square, so the bay reads as one rack. Controls,
chips, badges, key caps, notices, the permission card and the terminal peek
take a 3px corner. Menus, popovers and tooltips take 5px. Marks are 8px:
circles for live and waiting states, a diamond for not responding, a square
for stopped. Icons are 16px line drawings at a 1.5 stroke, 12px inside chips
and pickers.

## Components

### Strip

The one fixed-height row for every list of live things: sessions, tool calls,
changed files, terminals, resources and menus.

- **Grid:** lead, main, meta. The 56px strip has two 24px lines (name and
  agent, then state line and figures), led by an 8px mark. The icon strip
  leads with a 16px icon. The 32px row strip is one line.
- **Hover:** raised surface, colour transition at 120ms.
- **Selected:** selected surface plus an inset 1px `line-control` ring, set
  with `aria-current` or `aria-selected`. Icons turn from Mist to text colour.
- **Keyboard:** arrow keys step through the bay's strips.

### Bay

The rack. Three sections in attention order, each under a label and count.

- **Needs you:** the label and count turn green. Its strips sit on the raised
  surface, separated by 1px rules in the bay colour, and carry the only full
  contrast names in the bay. State lines take their state colour.
- **Running:** names step back to Mist at weight 500. The spinning mark and
  the mono state line keep it ahead of Settled.
- **Settled:** names in Mist at weight 400.
- The open session and a hovered strip return to text colour in every
  section.

**The Attention Rack Rule.** The bay racks strips by what they need, and only
Needs you holds full voice. Running and Settled recede through colour and
weight, never through opacity, so their text keeps AA contrast on the bay.

### Arrival motion

The system's one authored motion. When a running session starts waiting, its
strip lifts out of Running, travels to the top of Needs you and settles into
the green band, while the strips it passes slide aside.

- The strip's mark, state line and section counts change first, so the new
  state reads before the travel.
- Travel is 640ms from the strip's visible place: a 4px lift with the Lift
  shadow and a bay-to-raised background over the first 15%, the move on the
  exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`), and a settle on
  `cubic-bezier(0.2, 0, 0, 1)`.
- Displaced strips and headings slide 480ms on the same ease-out after a
  90ms delay.
- Under reduced motion the strip changes place at once and its band fades in
  over 100ms.

Everything else uses the feedback tokens: colour transitions at 120ms and
overlay slides at 240ms, both on the exponential ease-out. The running mark
spins at 900ms per turn. Nothing else moves.

### Request card

The one green surface on a view: something waits on the developer. The
session's permission request and a resource's change preview share it.

- **Shape:** 3px corner, 1px accent border, a 6% accent wash over raised.
- **Head:** the waiting mark and a 16px question on a 15% accent band above a
  40% accent rule.
- **Body:** everything under the head hangs from the question's leading edge.
  Actions carry key caps (Y, A, N). Allow once is the primary; secondary
  buttons step up to `line-strong` borders on the wash.
- **Disabled:** while Pau reconnects, the card stays visible and its actions
  disable with a reason.

### Buttons

- **Shape:** 3px corner, 32px tall, 12px side padding, 14px label at 500.
- **Default:** raised surface, `line-control` border. Hover moves to selected
  with `line-strong`, press to the bay tone.
- **Primary:** green fill, Green Ink label at 600. One per surface. Hover
  moves the green a quarter toward the text colour, press nearly half.
  Disabled drops to raised with Mist and no accent, so it never reads as
  enabled.
- **Quiet:** no border at rest, Mist label, raised on hover.
- **Danger:** Rose label and a 60% Rose border, kept apart from the other
  actions after a header rule. Stop is the example.
- **Icon:** 32px square with an accessible name.
- **Disabled:** Mist label and no hover or press. A disabled default button
  fades its border to half, and a disabled quiet button fades its Mist label
  further.

### Inputs

- **Field:** 32px, ground fill, `line-control` border, 3px corner, an
  optional leading icon and trailing key cap. Focus draws the shared 2px cyan
  ring, 2px outside the field. Invalid turns the border Rose.
- **Select and picker:** 32px. Pickers are borderless 14px Mist triggers that
  lift to raised on hover and when open.
- **Check:** 16px square, 3px corner, fills with text colour when checked.

### Navigation

- **View row:** one 32px quiet icon button per view across the bay's foot.
  The current view takes the selected treatment. Each names its view and
  shortcut in a tooltip on hover and keyboard focus. A view that needs a
  workspace stays disabled at half-strength icon, and its tooltip gives the
  reason.
- **Tabs:** 32px compact tabs with the selected treatment. Vertical section
  rails become horizontal tab strips below 1200px.

### Settings

A section rail on the left and one scrolling column of settings. The sections,
in order: Appearance, Agents, Sandbox, Notifications, Editor, Shell, Keyboard
and About.

- **Setting:** the name and its scope chip on one line, the description 4px
  below, the control 8px below that, all on the name's leading edge.
  Settings sit 24px apart. Descriptions and controls stop at 40rem, except
  the theme cards, which span the section.
- **Appearance:** theme cards painted in their own colours, the interface
  font and the code font (each choice set in its own face), text size and
  motion.
- **Agents:** readiness per agent, with its fix, and the default model.
- **Sandbox:** the workspace's default profile and its effective access, as a
  summary. Editing grants opens the Agent sandbox view.
- **Notifications:** one checkbox per event: waits for you, fails, finishes a
  turn, stops responding. Then the app icon badge and a sound.
- **Editor:** where Open in editor sends a file (system default, a detected
  editor, a terminal editor, or a custom command with `{file}` and `{line}`),
  then tab width and long-line wrap for the built-in editor and diffs.
- **Shell:** the login shell Pau reads `PATH` from, with Read again, and the
  workspace environment, including loading `.envrc` through direnv.
- **Keyboard:** the read-only shortcut table.
- **About:** the build, its details and the theme and font credits.
- **Narrow:** the section rail becomes a row of tabs above the column.

### Notices and menus

- **Notice:** in the flow, never sticky over content. Raised surface, `line`
  border, a state-coloured 16px icon, text in text colours, actions on the
  right.
- **Menu:** overlay surface, 5px corner, Overlay shadow, at least 240px wide.
  It opens from the top edge of the row group that owns it, so it never
  covers that row.

## Do's and Don'ts

### Do:

- **Do** put every list of live things in strips: 56px two-line or 32px
  one-line, lead, main, meta.
- **Do** keep Needs you as the only lifted, green-headed section in the bay.
- **Do** make every control 32px tall, including buttons in notices, cards
  and banners.
- **Do** centre labels on their capitals with a trimmed text box.
- **Do** set paths, commands, counts and durations in Overpass Mono with
  ligatures off.
- **Do** pair every state colour with a mark shape and a text label.
- **Do** break long paths after a slash and long identifiers at `::` and `_`.

### Don't:

- **Don't** use green for anything beyond what waits on the developer and the
  surface's one primary action.
- **Don't** fill rows, titles or backgrounds with state colours.
- **Don't** recede text with opacity. Use Mist and a lighter weight.
- **Don't** put a shadow on a resting surface.
- **Don't** add a second authored motion, or animate the transcript or the
  terminal canvas.
- **Don't** draw the agent as a person or the transcript as chat bubbles.
- **Don't** add editor boilerplate such as encoding, line endings or indent
  to the status bar. It shows only the cursor position and the save state.
