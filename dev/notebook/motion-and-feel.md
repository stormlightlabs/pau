# Motion and feel

This note collects research on what makes a desktop agent interface feel fast
and calm, checks it against Pau's stack, and audits the current UI. It ends
with a proposed motion specification for `dev/design/system.md` and proposed
roadmap units. Nothing here is a decision until the owning documents adopt it.

## Principles

1. Respond to input within 100ms, and aim for 50ms. Nielsen puts the limit of
   "instant" at 0.1s ([NN/g response times][nng-limits]). Superhuman treats
   100ms as the ceiling and targets under 50ms ([Superhuman][superhuman]).
   Google rates interactions slower than 200ms INP as needing improvement
   ([web.dev INP][inp]).
2. Keep the whole loop under 400ms. Doherty and Thadani set 400ms as the
   response time below which people stop waiting on the machine
   ([Laws of UX][doherty]).
3. Keep routine animation between 100 and 250ms. NN/g recommends about 100ms
   for small feedback, 200–300ms for larger changes, and treats 400ms as slow
   ([NN/g animation duration][nng-duration]). Emil Kowalski keeps UI motion
   under 300ms ([Great animations][emil-great]). Pau's design already says
   100–250ms.
4. Do not animate frequent or keyboard-initiated actions. Apple says to avoid
   motion on frequent interactions ([HIG Motion][hig-motion]). Raycast, opened
   hundreds of times a day, has no open animation
   ([You don't need animations][emil-dont]).
5. Make exits shorter than entrances. NN/g gives 300ms in and 200–250ms out as
   an example ([NN/g animation duration][nng-duration]).
6. Enter with deceleration, leave with acceleration, move with a standard
   curve. Material 3 and Fluent both encode this split
   ([M3 tokens][m3-tokens], [Fluent curves][fluent-curves]).
7. Never block input on an animation. Apple: "don't make people wait for an
   animation to complete before they can do anything"
   ([HIG Motion][hig-motion]). Use interruptible CSS transitions or Svelte
   transitions that reverse mid-flight.
8. Animate only `transform` and `opacity` for movement. They skip layout and
   paint and can run off the main thread ([Great animations][emil-great],
   [Svelte transitions][svelte-transition]).
9. Fit in one frame. A 120Hz display leaves 8.33ms per frame for state, layout,
   and paint ([Zed][zed-120]). Recent MacBook Pros run at 120Hz.
10. Skip loading indicators for waits under 1s, use a spinner or skeleton up to
    10s, and use determinate progress with a cancel control beyond 10s
    ([NN/g skeletons][nng-skeleton], [NN/g response times][nng-limits]).
11. Reduced motion means fades instead of movement, not no feedback. Apple
    lists replacing x, y, and z movement with fades
    ([HIG Accessibility][hig-a11y]). Chrome's View Transitions guide makes the
    same point ([same-document view transitions][vt-same]).
12. Content above the reading position must not move. Streaming, collapsing
    tool output, and notices must not shift what the operator is reading.

## Platform guidance

### Apple Human Interface Guidelines

The [Motion][hig-motion] page asks for purposeful, brief, optional, and
cancellable motion:

- "Add motion purposefully, supporting the experience without overshadowing
  it."
- "Make motion optional": motion must not be the only way to communicate
  information.
- "Aim for brevity and precision in feedback animations."
- "In apps, generally avoid adding motion to UI interactions that occur
  frequently."
- "Let people cancel motion."

The [Accessibility][hig-a11y] page lists what Reduce Motion should change:
tighten springs, track gestures directly, avoid animating depth, replace
x, y, and z movement with fades, and avoid animating into and out of blurs. It
also asks for a higher-contrast scheme when Increase Contrast is on.

The [Popovers][hig-popovers] page applies to Pau's pickers and meters:

- Close a popover on an outside click or on selection, unless several
  selections are possible.
- Never cascade popovers. Close the open one before showing another, and let
  one click do both.
- Discard work only on an explicit Cancel.
- Animate a popover's size change so it does not look like a replacement.

The [Progress indicators][hig-progress] page prefers determinate progress,
asks to switch from indeterminate to determinate once the duration is known,
and says to keep indicators moving because people read a still indicator as a
stall. On macOS it prefers a small unlabeled spinner for background work.

The [Focus and selection][hig-focus] page says macOS uses a focus ring for
text and search fields and a full-row accent highlight for focused list items.
Pau's left-edge indicator plus surface change for selected rows fits this.

Apple's vibrancy and translucent materials conflict with Pau's flat visual
thesis, which rules out floating glass. WebKit also does not implement
`prefers-reduced-transparency` (see the support table below). Pau should keep
opaque surfaces.

### Material 3

[Material 3 motion tokens][m3-tokens] from the `material-web` source:

| Token                        | Value                           |
| ---------------------------- | ------------------------------- |
| easing-standard              | cubic-bezier(0.2, 0, 0, 1)      |
| easing-standard-decelerate   | cubic-bezier(0, 0, 0, 1)        |
| easing-standard-accelerate   | cubic-bezier(0.3, 0, 1, 1)      |
| easing-emphasized-decelerate | cubic-bezier(0.05, 0.7, 0.1, 1) |
| easing-emphasized-accelerate | cubic-bezier(0.3, 0, 0.8, 0.15) |
| duration-short1–4            | 50, 100, 150, 200ms             |
| duration-medium1–4           | 250, 300, 350, 400ms            |
| duration-long1–4             | 450, 500, 550, 600ms            |

Material's medium and long steps suit touch devices and large travel. A dense
desktop surface lives mostly in the short range.

### Fluent 2

[Fluent durations][fluent-durations] run 50, 100, 150, 200, 250, 300, 400, and
500ms. [Fluent curves][fluent-curves] include `decelerateMid`
`cubic-bezier(0, 0, 0, 1)`, `accelerateMid` `cubic-bezier(1, 0, 1, 1)`, and
`easyEase` `cubic-bezier(0.33, 0, 0.67, 1)`. The [Fluent motion
guide][fluent-motion] scales duration with element size and travel, staggers
large sets with shrinking offsets, and asks for a no-motion setting.

### WCAG 2.2

- 2.3.3 Animation from Interactions (AAA): motion triggered by interaction can
  be disabled unless essential. Opacity and color changes are not motion
  under the definition, but blur is again included after an erratum.
  Scrolling content into view counts as essential. The sufficient techniques
  are the CSS and JavaScript `prefers-reduced-motion` queries and an in-app
  preference ([Understanding 2.3.3][wcag-233]).
- 2.2.2 Pause, Stop, Hide (A) covers motion that starts on its own, lasts over
  five seconds, and runs beside other content. An indefinite "running"
  shimmer next to the transcript falls under it.
- 2.4.7 Focus Visible (AA), 2.4.11 Focus Not Obscured (AA), and 2.4.13 Focus
  Appearance (AAA) govern focus rings, including focus inside sticky composers
  and overlays.

### Reduced motion and contrast media queries

`prefers-reduced-motion` and `prefers-contrast` work in every Tauri webview
Pau targets. `prefers-reduced-transparency` does not work in WebKit. See the
support table under the stack section.

## What makes fast apps feel fast

Published detail from these products is uneven. These are the claims with a
primary or near-primary source:

- Superhuman applies a 100ms rule, aims for under 50ms, gives every action a
  shortcut, shows shortcut hints, keeps a local mail database, and preloads
  likely threads ([Superhuman][superhuman]).
- Linear runs on a client-side sync engine that its CTO describes in a talk
  ([Scaling the Linear sync engine][linear-sync]). Secondary analyses say it
  applies changes to local state first and syncs in the background, so the
  server is off the interaction path ([How is Linear so fast][linear-fast]).
- Zed targets the display refresh rate, 120fps and 8.33ms per frame, and
  names garbage-collection pauses in Atom as the reason it left the web stack
  ([Zed][zed-120]).
- Warp reported a 1.9ms average redraw and over 144fps at 4K in 2021
  ([How Warp works][warp]).
- Raycast's launcher appears without animation
  ([You don't need animations][emil-dont]).

No primary design documentation was found for Arc, Things, the Codex desktop
app, Claude desktop, or Conductor. They should not be cited as precedent.

The common pattern across these sources:

- Local state answers first. The UI changes in the same frame as the input,
  and the network or process confirms later.
- Keyboard paths have no animation and no confirmation steps for reversible
  actions.
- Nothing jumps. Lists keep their row height, panes keep their width, and
  loading content reserves its space.
- Indicators appear only when a wait is long enough to notice.
- Work is preloaded where the next step is predictable, such as the next
  session in a rail.

Pau's equivalent of local-first is its loopback backend: the round trip is
short, but it is not zero, and agent work can take minutes. The UI should echo
operator input immediately and show process state honestly.

## Interaction patterns

### Streaming transcript text

- Append, do not re-render. Chrome's guidance for streamed model output is to
  append text with `append()` or `insertAdjacentText()`, avoid resetting
  `textContent` or `innerHTML`, and use a streaming Markdown parser that only
  appends new nodes ([Render LLM responses][chrome-llm]). In Svelte, keep
  completed entries stable so only the active entry's text node changes.
- Coalesce deltas per frame. Agents can emit dozens of deltas per second.
  Apply all deltas that arrived since the last frame in one state update
  scheduled with `requestAnimationFrame`. The AI SDK exposes the same idea as
  a `throttle` wait for chat updates ([AI SDK useChat][ai-sdk-chat]).
- Do not fade in tokens or animate a typing cursor. Text arriving is already
  motion, and a per-token effect costs work every frame.
- Sanitize the combined Markdown output, not each chunk, if Pau renders
  Markdown ([Render LLM responses][chrome-llm]).
- Narrow the live region. A polite live region on the whole transcript asks a
  screen reader to announce every delta. Announce completed messages, status
  changes, and errors instead.

### Follow mode and scroll anchoring

- Follow new content while the viewport is at the bottom. Stop following when
  the operator scrolls up, and resume when they return to the bottom or press
  a "Jump to latest" control.
- Do not rely on CSS scroll anchoring. `overflow-anchor` reaches Safari only in
  version 27, so WKWebView on Pau's supported macOS versions and current
  WebKitGTK lack it ([MDN compat data][bcd]). StackBlitz's `use-stick-to-bottom`
  implements anchoring in JavaScript for the same reason, using
  `ResizeObserver` and distinguishing user scrolls from its own
  ([use-stick-to-bottom][stick-to-bottom]).
- Detect user intent from `wheel`, `touchmove`, keyboard scrolling, and
  scrollbar drags, not from every `scroll` event, because programmatic scrolls
  also fire `scroll`.
- Treat "at bottom" as within a small threshold, about 24px, so subpixel
  rounding does not break follow mode.
- When following, jump to the bottom instead of animating. Content grows in
  variable steps, and duration-based smooth scrolling lags behind it. The
  `use-stick-to-bottom` authors use a velocity spring for this reason.
- When an entry above the viewport changes height, correct `scrollTop` by the
  difference so the visible content stays still.
- Restore each session's scroll position, or follow mode, when switching
  sessions.

### Tool calls and thinking blocks

- Keep the operator's choice. A block the operator opened stays open after the
  tool finishes, and a block they closed stays closed when output arrives.
- Do not auto-collapse a finished block while it is in view. Collapse it only
  if it is off screen, or leave it open and collapse finished blocks once the
  turn ends.
- If expansion is animated, keep it under 200ms, and do it only for blocks
  shorter than about one viewport. Animate the disclosure with
  `grid-template-rows: 0fr` to `1fr` or with `::details-content` where
  available. Never animate the height of a block that is still streaming.
- Rotate the disclosure chevron with `transform` in about 100ms.

### Diffs

- Render a diff in its final layout. Hunks may reveal with a short fade, but
  line positions must not animate.
- When a live session updates a file already shown, mark changed hunks with a
  brief background tint that fades over about 1s. Under reduced motion, keep a
  static marker.
- Expanding a collapsed file follows the tool-call disclosure rule.

### Session status

- Give each state a distinct shape, label, and color: idle, running, waiting,
  failed, starting, stopping, and stopped. Idle and running currently share
  the same green dot.
- Change state colors with a 100ms color transition. Do not slide or scale
  status chips.
- Running work may use one small looping indicator, such as a spinner beside
  the label, because Apple asks indicators to keep moving. Under reduced
  motion, replace it with a static running mark. Do not shimmer large areas.
- A transition into waiting or failed is the only status change that deserves
  attention. Pulse the rail marker once, then hold a static badge until the
  operator views the session.

### Attention without nagging

- Use one channel per urgency: a static rail badge for waiting, a badge plus
  native notification when the window is unfocused (unit 2.153), and an inline
  alert for failures in the active view.
- Never loop an attention animation. A single pulse of about 600ms is enough.
- Clear the badge when the operator opens the session, not when the state
  changes again.

### Notifications and toasts

- Toasts are for outcomes that do not need action: an exported transcript, a
  copied path, an extension's informational notice.
- Enter from the same edge they leave, in about 200ms in and 150ms out.
- Auto-dismiss informational toasts after about 5s, pause the timer on hover
  and focus, and keep errors until dismissed.
- Use `role="status"` for information and `role="alert"` only for errors.
- Stack at most three. Collapse older ones into a count.

### Long operations

Compaction, retries with backoff, session start, and package installation run
for seconds to minutes.

- Wait about 400ms before showing an indicator, then keep it visible for at
  least 500ms so it does not flash.
- Show elapsed time in tabular numerals for indeterminate work, and show the
  retry attempt and next attempt time for backoff.
- Switch to determinate progress when the backend can report it.
- Offer cancel or interrupt where the backend supports it.
- Keep the transcript usable while the operation runs.

### Loading states

- Under 1s, show nothing new. Keep the previous content.
- For a transcript or file list that takes longer, show a static placeholder in
  the final layout. Avoid shimmer, which NN/g flags as distracting
  ([NN/g skeletons][nng-skeleton]).
- Never show a frame-only skeleton without content placeholders.

### Optimistic updates

- Echo a submitted prompt in the transcript at once as pending, clear the
  composer, and reconcile when the backend event arrives. On failure, mark the
  entry failed and restore the draft.
- Apply renames, queue edits, and toggles locally, and roll back with an inline
  error when the backend rejects them.
- Never show optimistic state for process control. A stop request is
  "Stopping" until the process reports it stopped.

### Panels, rails, and the inspector

- On wide layouts, a toggle from the top app bar opens or closes the
  inspector or context rail. Animate the grid column only if it stays within
  one frame budget; otherwise switch instantly and fade the content in over
  150ms. Do not reflow the transcript on every frame.
- On narrow layouts, overlays slide from their edge in 200ms with
  `transform`, with a scrim that fades in 150ms, and close in 150ms.
- Keyboard toggles switch instantly.

### Popovers and menus

- Pointer-opened popovers fade and scale from 0.98 to 1 over 150ms from their
  anchor (`transform-origin` at the anchor edge), and close in 100ms.
- Keyboard-opened completion lists, such as slash commands, appear instantly.
- Opening one popover closes any other ([HIG Popovers][hig-popovers]).

### Dialogs

- Use `<dialog>` with `showModal()` for focus trapping and `inert` background.
- Fade the backdrop and the dialog in over 200ms with a 0.98 to 1 scale, and
  close in 150ms.
- Keep the dialog mounted during its exit animation, then restore focus.
  `@starting-style` and `transition-behavior: allow-discrete` can animate
  `<dialog>` and `popover` entry and exit in CSS, but they need Safari 17.5
  and 17.4. On older WebKit the dialog appears without animation, which is an
  acceptable fallback.

### Command bar

Pau's frontend plan keeps a command bar globally available, but no unit builds
a palette yet. When one exists, it should open instantly from the keyboard,
filter in the same frame as typing, keep row height fixed, and close instantly
on Escape or selection. Pointer opening may use a 100ms fade.

### Focus management

- Every overlay returns focus to its invoker when it closes. If the invoker is
  gone, focus moves to the nearest stable landmark, usually the composer.
- Focus never lands on an element that is animating out.
- Focus rings appear instantly. Never transition `outline`.
- Use one focus color token, a 2px ring, and an offset that keeps the ring
  inside scroll containers so it is not clipped.

### Drag and drop

- Show the drop target on `dragenter` within one frame: a 1px accent outline
  and a surface tint. Do not resize the composer.
- Reject unsupported files before the drop by showing a "not allowed" state
  and a short reason.
- After a drop, show the attachment chip immediately and read the file in the
  background.

### Hover and press

- Hover changes background color only, in about 100ms, or instantly in dense
  lists. Remove hover effects under `(hover: none)`.
- Press feedback is a color change. Do not translate dense rows or tabs on
  press. A 1px press offset fits only free-standing buttons.
- macOS controls use the arrow cursor. Reserve the pointing hand for links.
- Chrome text, such as rail labels and buttons, should not be selectable.
  Transcript, code, paths, and errors must stay selectable.

### Terminal tabs

- Switch tabs instantly. Do not fade or slide an xterm.js canvas.
- Preserve each tab's scroll position and focus.
- Activity and exit markers follow the attention rules above.

### Task-surface changes

`dev/design/system.md` already specifies a short fade with a small directional
offset. Use about 200ms in, an offset of 4px, and no exit animation, so the
new surface is interactive immediately. Rail navigation with the keyboard
switches without motion.

## Stack techniques and gotchas

### Svelte 5

- Svelte transitions run on the Web Animations API, so a global CSS
  `prefers-reduced-motion` rule does not affect them. Use
  `prefersReducedMotion` from `svelte/motion` (since 5.7) to change their
  parameters ([Svelte transitions][svelte-transition],
  [svelte/motion][svelte-motion]).
- Prefer `css` over `tick` in custom transitions so the animation can run off
  the main thread ([Svelte transitions][svelte-transition]).
- Transitions are local by default and play only when their own block mounts
  or unmounts. Mark a transition `|global` only when a parent block change
  should play it.
- `animate:flip` works only on direct children of a keyed `{#each}`. Use it for
  reordering short lists such as the queue, not for transcripts.
- `Tween` and `Spring` (since 5.8) suit numeric values such as a context meter.
  Set them with `instant: true` under reduced motion.
- `introend` and `outroend` events are the hook for focus restoration after an
  overlay finishes leaving.

### CSS and DOM features in Tauri webviews

Tauri uses WKWebView on macOS and WebKitGTK on Linux
([Tauri webview versions][tauri-webviews]). On macOS the engine follows the
installed Safari version, so Pau's minimum of macOS 14 means Safari 17.0 at
worst, though most systems run Safari 18 or 26. WebKitGTK versions come from
the distribution. Support from [MDN browser-compat-data][bcd] 8.1.6:

| Feature                               | Safari  | Chrome | Use in Pau                    |
| ------------------------------------- | ------- | ------ | ----------------------------- |
| `prefers-reduced-motion`              | 10.1    | 74     | Required                      |
| `prefers-contrast`                    | 14.1    | 96     | Required                      |
| `prefers-reduced-transparency`        | no      | 118    | Do not depend on it           |
| `Element.animate()` (Svelte)          | 13.1    | 36     | Required                      |
| `linear()` easing                     | 17.2    | 113    | Avoid at the macOS 14 floor   |
| `popover`                             | 17      | 114    | Usable                        |
| `transition-behavior: allow-discrete` | 17.4    | 117    | Progressive enhancement       |
| `@starting-style`                     | 17.5    | 117    | Progressive enhancement       |
| `startViewTransition()`               | 18      | 111    | Progressive enhancement       |
| `view-transition-class`               | 18.2    | 125    | Progressive enhancement       |
| `content-visibility`                  | 18      | 85     | Progressive enhancement       |
| `::details-content`                   | 18.4    | 131    | Progressive enhancement       |
| `scrollbar-gutter`                    | 18.2    | 94     | Progressive enhancement       |
| Anchor positioning                    | 26      | 125    | Not yet                       |
| Scroll-driven animations              | 26      | 115    | Not yet                       |
| `scrollend` event                     | 26.2    | 114    | Not yet                       |
| `overflow-anchor`                     | 27      | 56     | Not yet; anchor in JavaScript |
| `interpolate-size`, `calc-size()`     | no      | 129    | Do not use                    |
| `closedby` on `<dialog>`              | preview | 134    | Do not use                    |
| `scheduler.yield()`                   | no      | 129    | Do not use                    |

Consequences:

- Storybook and Vitest browser tests run in Chromium, which supports features
  WKWebView lacks. A transition that depends on `interpolate-size` or
  `overflow-anchor` will pass tests and fail in the app. Critical motion and
  scrolling checks need a WebKit run, as `dev/plan/testing.md` already
  requires for critical Playwright flows.
- Height animation must use `grid-template-rows` or measured heights, not
  `height: auto` interpolation.
- The View Transitions API freezes rendering while the update callback runs
  ([same-document view transitions][vt-same]). Do not wrap a transition
  around work that waits on the backend. Two elements with the same
  `view-transition-name` skip the transition. Pau's task-surface fade does not
  need the API; a Svelte transition covers it.
- WebKitGTK has driver-specific compositing problems. Tauri documents
  disabling the DMABUF renderer or compositing as workarounds
  ([Tauri Linux graphics][tauri-linux]), and WebKit has open reports of slow
  CSS animations with async scrolling on GTK ([WebKit 221738][webkit-221738]).
  Linux motion should degrade to instant changes without losing state.

### Layout and rendering

- Read layout values before writing styles in the same frame. Measuring
  `scrollHeight` after appending text and then writing `scrollTop` forces one
  layout per write; batch both in the frame callback.
- Use `content-visibility: auto` with `contain-intrinsic-size: auto <guess>`
  on completed transcript entries. web.dev reports a drop from 232ms to 30ms
  rendering on a long page, and notes content stays in the accessibility tree
  ([content-visibility][content-visibility]). It needs Safari 18, so it is an
  enhancement, not a substitute for virtualization.
- Use `contain: layout paint` on independent panes so a transcript update does
  not relayout the rails.
- Use `will-change` only during an animation and remove it afterwards.
- Avoid animating `box-shadow`, `filter`, `backdrop-filter`, `width`,
  `height`, `top`, and `left`.

## Reduced-motion and contrast strategy

- Read three sources into one setting: the OS `prefers-reduced-motion` query,
  an in-app preference (system, reduce, or full), and a Storybook global. Put
  the result on the root element as `data-motion="reduce"` or
  `data-motion="full"`.
- In CSS, collapse distance tokens to zero under reduced motion. Transitions
  that use the tokens become fades with no component change.
- In Svelte, read the same setting from one shared module and pass `y: 0`,
  `x: 0`, and `start: 1` to transitions, or skip them.
- Keep color and opacity feedback at 100ms or less under reduced motion. WCAG
  2.3.3 does not treat it as motion.
- Replace indefinite indicators, such as the running spinner, with static
  marks. Replace attention pulses with static badges.
- Keep smooth scrolling off under reduced motion. Follow mode already jumps.
- For `prefers-contrast: more`, raise hairline rules from 0.5px to 1px, as
  `dev/design/system.md` already specifies, strengthen muted text, and thicken
  focus rings. No component reads `prefers-contrast` today.
- Honor `forced-colors: active` by using system colors for focus and
  selection.

## Testing motion

- Storybook: the toolbar's reduced-motion global should set the same root
  attribute the app uses. Today it only shortens CSS durations with
  `!important`, which misses Svelte transitions because they use the Web
  Animations API.
- Storybook play functions can call `document.getAnimations()` after an
  interaction and assert that reduced motion leaves no transform animations.
- Vitest browser mode: the Playwright provider accepts `contextOptions`, so a
  second instance can run with `reducedMotion: 'reduce'`
  ([Vitest Playwright provider][vitest-playwright]). Playwright pages can also
  call `page.emulateMedia({ reducedMotion: 'reduce' })`.
- Prefer deterministic assertions to timing: count state commits per frame
  while replaying a fixture stream, check that `scrollTop` stays at the bottom
  in follow mode, and check that the first visible entry does not move when an
  entry above it collapses.
- Measure frame budgets in a dedicated Chromium job with a long-task
  `PerformanceObserver` and a recorded fixture stream. Long-task timing is not
  available in WebKit, so WebKit runs check behavior only.
- Screenshot tests should disable animations so timing never reaches the
  pixels.

## Pau today

Files read: `AGENTS.md`, `dev/design/system.md`, `dev/design/surfaces.md`,
`dev/plan/frontend.md`, `dev/plan/testing.md`,
`packages/ui/src/styles/tokens.css`, the components in `packages/ui/src/lib`,
`packages/ui/.storybook`, and the transcript reducer in
`apps/desktop/src/lib/pi-transcript.ts`.

What exists:

- `dev/design/system.md` sets 100–250ms for routine changes, a short fade with
  a small offset for task-surface changes, no decorative live status, and a
  reduced-motion rule that removes spatial movement. `dev/plan/frontend.md`
  names Svelte's motion APIs as the implementation.
- `tokens.css` has spacing, type, radius, border, and size tokens, but no
  duration, easing, or distance tokens.
- Two components animate:
  - `ApplicationShell.svelte` slides the narrow context rail with
    `transform 180ms ease` and a `visibility` transition, with a
    `prefers-reduced-motion` override.
  - `CapabilityCard.svelte` transitions `background` and `transform` over
    140ms and moves the button 1px on press.
- No component imports `svelte/transition`, `svelte/animate`, or
  `svelte/motion`. There are no `@keyframes`.
- Storybook has a reduced-motion global that sets `data-reduced-motion` and
  forces CSS durations to 0.01ms.
- Focus rings exist in the shell as a 2px `--shell-focus` outline with a -2px
  offset. `CapabilityCard` uses a 3px outline with a 3px offset.

Inconsistencies and defects:

- The two durations, 180ms and 140ms, and the CSS `ease` keyword are
  one-offs. Neither uses a token.
- The Storybook reduced-motion toggle does not reach Svelte transitions or
  `prefersReducedMotion`, and the shell's own media query ignores it.
- Transcript streaming re-renders on every delta. `applyMessageUpdate`
  concatenates the body and copies the entry list for each `text_delta` and
  `thinking_delta`, with no per-frame batching.
- The transcript has no follow mode. It is an `overflow: auto` grid, and
  WebKit before Safari 27 has no CSS scroll anchoring, so long output either
  stays put or jumps depending on content changes.
- Tool and thinking blocks bind `open` to completion state:
  `open={entry.status !== 'complete'}` and `open={!entry.complete}`. A block
  collapses under the reader when it finishes, and the operator's manual
  choice is overwritten.
- The whole transcript has `aria-live="polite"`, so screen readers are asked to
  announce every streamed change.
- Prompt submission waits for the backend. The draft stays in the composer
  until `onSend` resolves, and the user message appears only when the event
  arrives.
- Idle and running sessions share the same green dot, and no status has an
  indicator other than color and label.
- The extension dialog mounts and unmounts with `{#if}`, so it cannot animate
  out, and focus restoration after it closes is not handled in the component.
- Extension notifications appear and disappear without timing rules or
  dismissal controls.
- Loading states are text only ("Loading sessions…") and appear immediately,
  so fast loads flash.
- No component honors `prefers-contrast`, although `dev/design/system.md`
  calls for 1px rules under increased contrast.
- `CLAUDE.md` refers to `packages/prototype`, which does not exist in this
  checkout. Prototype screenshots live in `dev/prototype`.

## Proposed specification

This section is written to replace the Motion section of
`dev/design/system.md`.

### Motion

Motion shows cause, continuity, and state. It never decorates, never delays
input, and never moves content the operator is reading.

#### Tokens

`packages/ui/src/styles/tokens.css` defines theme-independent motion tokens
next to the scale tokens. A TypeScript module in `packages/ui` exports the
same values as numbers for Svelte transitions, and a contract test keeps the
two in sync.

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
}

:root[data-motion='reduce'] {
	--pau-motion-offset-sm: 0;
	--pau-motion-offset-md: 0;
	--pau-motion-scale-enter: 1;
}
```

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

#### Rules by component class

| Component                      | Enter                        | Exit     | Notes                          |
| ------------------------------ | ---------------------------- | -------- | ------------------------------ |
| Hover and press                | feedback, color only         | feedback | Instant in dense lists         |
| Focus ring                     | instant                      | instant  | Never transition `outline`     |
| Selection indicator            | feedback, color              | feedback | No sliding indicator           |
| Session status                 | feedback, color              | feedback | One spinner only for running   |
| Attention marker               | one 600ms pulse              | instant  | Static badge after the pulse   |
| Disclosure (tool, thinking)    | medium, rows 0fr to 1fr      | small    | Instant if streaming or tall   |
| Popover, menu (pointer)        | small, fade and scale-enter  | feedback | Origin at the anchor           |
| Completion list (keyboard)     | instant                      | instant  |                                |
| Dialog                         | medium, fade and scale-enter | small    | Backdrop fades with it         |
| Overlay rail, narrow inspector | medium, translate from edge  | small    | Scrim fades over small         |
| Wide inspector, rail toggle    | instant layout, small fade   | instant  | No per-frame reflow            |
| Toast                          | medium, offset-md from edge  | small    | Same edge in and out           |
| Task-surface change            | large, fade and offset-sm    | none     | Keyboard navigation is instant |
| Terminal tab                   | instant                      | instant  | Never animate the canvas       |
| Diff hunk update               | 1s background tint fade      | —        | Static marker when reduced     |
| Transcript streaming           | none                         | —        | Append per frame, no fades     |
| Follow-mode scroll             | jump                         | —        | No smooth scrolling            |

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

#### Reduced motion

The root element carries `data-motion`, computed from the operator's motion
setting (system, reduce, or full) and the OS `prefers-reduced-motion` query.
Storybook's reduced-motion control sets the same attribute.

Under reduced motion:

- Distance and scale tokens collapse, so movement becomes a fade.
- Opacity and color feedback stays at `feedback` duration or less.
- Spinners and pulses become static marks.
- Svelte transitions read the shared motion setting and drop movement.
- Smooth scrolling is off.

#### Increased contrast

Under `prefers-contrast: more`, hairline rules become 1px, muted text moves
toward normal text, and focus rings grow to 3px. Under
`forced-colors: active`, focus and selection use system colors.

#### Performance budgets

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

## Proposed roadmap units

2.NEW-M1 to 2.NEW-M13 make daily use through Pau comfortable and should land
before or alongside 2.40. 2.NEW-M14 to 2.NEW-M31 are later polish. Every UI
unit also updates its Storybook stories, as `dev/ROADMAP.md` requires.

### 2.NEW-M1 Motion tokens

Status: planned
Blocked by: none

Add duration, easing, and distance tokens to `packages/ui` and move the
existing context-rail and capability-card transitions onto them.

Verification:

- Unit-test that the CSS tokens and the exported TypeScript values match.
- Confirm no component uses a literal duration or easing keyword.

### 2.NEW-M2 Reduced-motion setting

Status: planned
Blocked by: 2.NEW-M1

Combine the OS reduced-motion query and an operator setting into one root
attribute that CSS tokens and Svelte transitions both read.

Verification:

- Component-test the system, reduce, and full settings against both values of
  the OS query, using a Vitest Playwright instance with `reducedMotion`.
- Confirm Storybook's reduced-motion control sets the same attribute and that
  the context-rail story has no transform animation when it is on.

### 2.NEW-M3 Streaming delta batching

Status: planned
Blocked by: none

Apply all transcript deltas that arrive within one animation frame as a single
state update.

Verification:

- Unit-test that a burst of deltas produces one commit per frame and the same
  final transcript as unbatched application.
- Confirm `message_end` and tool events still apply in order relative to
  batched text.

### 2.NEW-M4 Transcript follow mode

Status: planned
Blocked by: none

Keep the transcript at the newest content while the operator is at the bottom,
and stop following when they scroll up.

Verification:

- Component-test following during streaming, detaching on wheel, keyboard, and
  scrollbar input, and reattaching at the bottom.
- Confirm a notice appearing or disappearing does not move the reading
  position.
- Run the follow and detach checks in WebKit.

### 2.NEW-M5 Jump to latest

Status: planned
Blocked by: 2.NEW-M4

Show a "Jump to latest" control while the transcript is detached and new
content has arrived.

Verification:

- Component-test the control appearing, its keyboard activation, and that it
  restores follow mode.

### 2.NEW-M6 Stable transcript disclosures

Status: planned
Blocked by: none

Keep tool and thinking blocks open or closed as the operator left them, and
stop collapsing finished blocks while they are in view.

Verification:

- Component-test a manually opened block that finishes, a manually closed
  block that receives output, and a finished block that stays in place.
- Confirm the first visible entry does not move when a block above it
  finishes.

### 2.NEW-M7 Transcript announcements

Status: planned
Blocked by: none

Announce completed messages, status changes, and errors to assistive
technology instead of every streamed change.

Verification:

- Component-test that the live region receives one announcement per completed
  message and none per delta.

### 2.NEW-M8 Optimistic prompt echo

Status: planned
Blocked by: none

Show a submitted prompt in the transcript as pending and clear the composer
before the backend confirms it.

Verification:

- Component-test confirmation replacing the pending entry, a failed send that
  restores the draft, and a queued prompt during a running turn.

### 2.NEW-M9 Session status indicator

Status: planned
Blocked by: 2.NEW-M2

Give each session state a distinct mark, with one small spinner for running
work that becomes static under reduced motion.

Verification:

- Component-test each state's label and mark, and the static running mark
  under reduced motion.

### 2.NEW-M10 Session attention markers

Status: planned
Blocked by: 2.NEW-M9

Mark sessions that wait for input or fail in the session rail, pulse the
marker once, and clear it when the operator opens the session.

Verification:

- Component-test marking, the single pulse, the static marker under reduced
  motion, and clearing on open.

### 2.NEW-M11 Overlay focus restoration

Status: planned
Blocked by: none

Return focus to the invoking control when a dialog, popover, or overlay rail
closes, or to the composer when the invoker is gone.

Verification:

- Component-test closing each overlay with Escape, with its close control, and
  after its invoker has unmounted.

### 2.NEW-M12 Focus ring consistency

Status: planned
Blocked by: none

Use one focus-ring token, width, and offset across every focusable control,
without clipping inside scroll containers.

Verification:

- Component-test focus-visible styling on representative controls in a
  scrolled transcript, the composer, and each overlay.
- Run Storybook accessibility checks for each changed story.

### 2.NEW-M13 Session scroll restoration

Status: planned
Blocked by: 2.NEW-M4

Restore each session's scroll position or follow mode when the operator
returns to it.

Verification:

- Component-test switching between a followed session and a detached one and
  back.

### 2.NEW-M14 Busy indicator timing

Status: planned
Blocked by: 2.NEW-M1

Delay loading and busy indicators by 400ms and keep them visible for at least
500ms once shown.

Verification:

- Unit-test the timing with fake timers, including a wait that ends before the
  delay and one that ends during the minimum display.
- Apply it to the session-list loading state and confirm a fast load shows no
  indicator.

### 2.NEW-M15 Long-operation progress

Status: planned
Blocked by: 2.NEW-M14

Show elapsed time for compaction and session start, and the attempt number and
next attempt time for automatic retries.

Verification:

- Component-test compaction, a retry countdown, and cancel where the session
  supports it, using fake timers.

### 2.NEW-M16 Disclosure motion

Status: planned
Blocked by: 2.NEW-M2, 2.NEW-M6

Animate tool and thinking block expansion for finished blocks shorter than one
viewport, and switch instantly otherwise.

Verification:

- Component-test that a short finished block animates, a streaming or tall
  block does not, and reduced motion removes the animation.
- Check the animation in WebKit.

### 2.NEW-M17 Inspector toggle

Status: planned
Blocked by: 2.NEW-M2

Open and close the wide inspector and context rail without per-frame
transcript reflow, fading their content in.

Verification:

- Component-test toggling from the top app bar and the keyboard, and that the
  keyboard path is instant.

### 2.NEW-M18 Narrow overlay motion

Status: planned
Blocked by: 2.NEW-M2

Slide the narrow context rail and inspector overlay from their edges over a
fading scrim.

Verification:

- Component-test opening, closing by scrim click and Escape, and the fade-only
  presentation under reduced motion.

### 2.NEW-M19 Popover presentation

Status: planned
Blocked by: 2.NEW-M2

Fade and scale pointer-opened pickers and meters from their anchor, keep
keyboard-opened completion lists instant, and close any open popover before
another opens.

Verification:

- Component-test the model picker, thinking-level picker, and context meter
  opened by pointer and keyboard, and opening one while another is open.

### 2.NEW-M20 Dialog presentation

Status: planned
Blocked by: 2.NEW-M2, 2.NEW-M11

Fade and scale extension dialogs in and out, keeping each mounted until its
exit finishes.

Verification:

- Component-test opening, confirming, cancelling, and a new request arriving
  while the previous dialog exits.

### 2.NEW-M21 Task-surface transition

Status: planned
Blocked by: 2.NEW-M2

Fade new task surfaces in with a small offset when the operator navigates by
pointer, and switch instantly from the keyboard.

Verification:

- Component-test that the incoming surface is interactive at once and that the
  keyboard path and reduced motion skip the offset.

### 2.NEW-M22 Notification toasts

Status: planned
Blocked by: 2.NEW-M2

Show extension and application notices as dismissible toasts that pause on
hover and focus and keep errors until dismissed.

Verification:

- Component-test auto-dismissal with fake timers, pausing, error persistence,
  and stacking beyond three.

### 2.NEW-M23 Diff update highlight

Status: planned
Blocked by: 2.NEW-M2

Tint diff hunks that change while a session runs, fading the tint over one
second.

Verification:

- Component-test a live hunk update, an unchanged hunk, and the static marker
  under reduced motion.

### 2.NEW-M24 Terminal tab continuity

Status: planned
Blocked by: none

Switch terminal tabs instantly while preserving each tab's scroll position and
focus.

Verification:

- Component-test switching between tabs with scrollback and returning to the
  previous scroll position and focus.

### 2.NEW-M25 Drop target feedback

Status: planned
Blocked by: 2.NEW-M1

Show a drop target on the composer without resizing it, and reject
unsupported files before the drop with a reason.

Verification:

- Component-test entering, leaving, dropping an image, and dragging an
  unsupported file.

### 2.NEW-M26 Hover and press states

Status: planned
Blocked by: 2.NEW-M1

Use token-driven color changes for hover and press on every control, with no
press movement in dense rows.

Verification:

- Confirm each control class in Storybook has hover, press, focus, and
  disabled states, and that hover is absent under `(hover: none)`.

### 2.NEW-M27 Desktop pointer and selection

Status: planned
Blocked by: none

Use the arrow cursor on controls and make application chrome unselectable
while transcript, code, paths, and errors stay selectable.

Verification:

- Component-test that a drag across the rail selects nothing and that
  transcript text remains copyable.

### 2.NEW-M28 Increased contrast

Status: planned
Blocked by: none

Strengthen rules, muted text, and focus rings under `prefers-contrast: more`,
and use system colors under `forced-colors: active`.

Verification:

- Component-test computed rule width and focus ring width with each media
  query emulated.
- Check every shipped theme in Storybook.

### 2.NEW-M29 Transcript history placeholder

Status: planned
Blocked by: 2.NEW-M14

Show a static placeholder in transcript layout while history takes longer than
the busy delay to load.

Verification:

- Component-test a fast load with no placeholder and a slow load with one.

### 2.NEW-M30 Streaming performance check

Status: planned
Blocked by: 2.NEW-M3

Replay a recorded 2,000-delta stream in Chromium and fail when a long task
exceeds 50ms or commits exceed one per frame.

Verification:

- Run the check against the current transcript and record its baseline.
- Confirm a deliberate per-delta re-render fails it.

### 2.NEW-M31 Long transcript rendering

Status: planned
Blocked by: 2.NEW-M30

Skip rendering of off-screen completed transcript entries with
`content-visibility` and a remembered intrinsic size.

Verification:

- Show an improvement in the streaming performance check on a long fixture.
- Confirm follow mode, search, and copying still work across skipped entries.

## Open questions

- Should Pau offer an in-app motion setting with system, reduce, and full, or
  follow only the OS? The proposal assumes the setting exists because WCAG
  lists it as a technique and it lets the operator reduce motion in Pau
  without changing OS settings.
- Which machine is the reference for the performance budgets? The proposal
  assumes a 120Hz MacBook Pro.
- Should finished tool blocks collapse at the end of a turn, stay open, or
  stay collapsed by default? Pi's TUI behavior may set the expectation.
- Should the running spinner appear in the session rail as well as the
  session header, or would that be too much motion with many sessions?
- Is a command palette planned? `dev/plan/frontend.md` mentions a command bar,
  but no unit builds one.
- Should the motion tokens live only in `tokens.css` with a TypeScript mirror
  checked by a test, or be generated from TypeScript like theme colors?
- `CLAUDE.md` refers to `packages/prototype`, which is missing. Should the
  guide point at `dev/prototype`, or is the package still planned?

[ai-sdk-chat]: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
[bcd]: https://github.com/mdn/browser-compat-data
[chrome-llm]: https://developer.chrome.com/docs/ai/render-llm-responses
[content-visibility]: https://web.dev/articles/content-visibility
[doherty]: https://lawsofux.com/doherty-threshold/
[emil-dont]: https://emilkowal.ski/ui/you-dont-need-animations
[emil-great]: https://emilkowal.ski/ui/great-animations
[fluent-curves]: https://github.com/microsoft/fluentui/blob/master/packages/tokens/src/global/curves.ts
[fluent-durations]: https://github.com/microsoft/fluentui/blob/master/packages/tokens/src/global/durations.ts
[fluent-motion]: https://fluent2.microsoft.design/motion
[hig-a11y]: https://developer.apple.com/design/human-interface-guidelines/accessibility
[hig-focus]: https://developer.apple.com/design/human-interface-guidelines/focus-and-selection
[hig-motion]: https://developer.apple.com/design/human-interface-guidelines/motion
[hig-popovers]: https://developer.apple.com/design/human-interface-guidelines/popovers
[hig-progress]: https://developer.apple.com/design/human-interface-guidelines/progress-indicators
[inp]: https://web.dev/articles/inp
[linear-fast]: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown
[linear-sync]: https://linear.app/blog/scaling-the-linear-sync-engine
[m3-tokens]: https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss
[nng-duration]: https://www.nngroup.com/articles/animation-duration/
[nng-limits]: https://www.nngroup.com/articles/response-times-3-important-limits/
[nng-skeleton]: https://www.nngroup.com/articles/skeleton-screens/
[stick-to-bottom]: https://www.npmjs.com/package/use-stick-to-bottom
[superhuman]: https://blog.superhuman.com/superhuman-is-built-for-speed/
[svelte-motion]: https://svelte.dev/docs/svelte/svelte-motion
[svelte-transition]: https://svelte.dev/docs/svelte/transition
[tauri-linux]: https://v2.tauri.app/develop/debug/linux-graphics/
[tauri-webviews]: https://v2.tauri.app/reference/webview-versions/
[vitest-playwright]: https://vitest.dev/config/browser/playwright
[vt-same]: https://developer.chrome.com/docs/web-platform/view-transitions/same-document
[warp]: https://www.warp.dev/blog/how-warp-works
[wcag-233]: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
[webkit-221738]: https://bugs.webkit.org/show_bug.cgi?id=221738
[zed-120]: https://zed.dev/blog/videogame
