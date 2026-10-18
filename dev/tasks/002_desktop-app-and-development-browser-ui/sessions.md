# 2. Desktop app: Sessions

## Composer

### 2.185 Built-in Pi slash commands

Status: in progress
Status note: Implemented and component-tested. The self-hosted run of `/new`,
`/name`, and `/compact` remains.
Blocked by: none

Complete and run Pi's built-in slash commands in the composer by mapping each to
its Pau action, and explain the commands that need vanilla Pi. `/fork` opens
the session tree's branch action.

Verification:

- Component-test completion, arguments for `/name`, `/model`, `/thinking`, and
  `/compact`, and an unavailable command with its reason.
- Run `/new`, `/name`, and `/compact` in a self-hosted session.

### 2.188 Drop target feedback

Status: planned
Blocked by: none

Show a drop target on the composer without resizing it, and reject unsupported
files before the drop with a reason.

Verification:

- Component-test entering, leaving, dropping an image, and dragging an
  unsupported file.

### 2.189 Composer external editor

Status: planned
Blocked by: 2.67

Open the composer draft in the preferred terminal or external editor with Ctrl+G
and put the saved text back in the composer.

Verification:

- Component-test a saved edit, a cancelled edit, and an editor that fails to
  start.

## Transcript

### 2.201 Transcript history placeholder

Status: planned
Blocked by: 2.221

Show a static placeholder in transcript layout while history takes longer than
the busy delay to load.

Verification:

- Component-test a fast load with no placeholder and a slow load with one.

### 2.202 Streaming performance check

Status: planned
Blocked by: none

Replay a recorded 2,000-delta stream in Chromium and fail when a long task
exceeds 50ms or commits exceed one per frame.

Verification:

- Run the check against the current transcript and record its baseline.
- Confirm a deliberate per-delta re-render fails it.

### 2.203 Long transcript rendering

Status: planned
Blocked by: 2.202

Skip rendering of off-screen completed transcript entries with
`content-visibility` and a remembered intrinsic size.

Verification:

- Show an improvement in the streaming performance check on a long fixture.
- Confirm follow mode, search, and copying still work across skipped entries.

## Session status and attention

### 2.206 Attention navigation

Status: planned
Blocked by: none

Jump to the next marked session with ⌘⌥A, taking waiting sessions first, then
failed, then unread.

Verification:

- Component-test jump order, wrapping past the last marked session, and no
  marked session.

### 2.207 Session change summary

Status: planned
Blocked by: none

Show the workspace's changed-file count and line totals in the session header
and open the inspector's Changes tab from it.

Verification:

- Component-test a clean tree, a dirty tree, a non-Git workspace, and a Git
  status failure.

### 2.208 Session archive

Status: planned
Blocked by: none

Store an archived flag for stopped sessions in Pau's database without changing
native session files.

Verification:

- Cover archiving, restoring, refusing a live session, and that native files
  stay unchanged.

### 2.209 Session archive view

Status: planned
Blocked by: 2.181, 2.208

Let the operator archive a stopped session from the rail and restore it from
Settings.

Verification:

- Component-test archive, restore, and the disabled control on a live session.

### 2.210 Long-operation progress

Status: planned
Blocked by: 2.221

Show elapsed time for a running turn in the session header's status slot and
for compaction and session start, and the attempt number and next attempt time
for automatic retries.

Verification:

- Component-test compaction, a retry countdown, and cancel where the session
  supports it, using fake timers.

## Pi parity

### 2.153 Attention notifications

Status: planned
Blocked by: none

Send a native notification and badge the app icon when a session waits for
input or fails while its view is not focused.

Verification:

- Component-test which session states notify and that a focused session does
  not.
- Trigger a notification from a self-hosted Pi session.

### 2.115 Pi shell commands API

Status: planned
Blocked by: none

Run shell commands through Pi's `bash` RPC command, stream
`bash_execution_update` events, and stop a running command with `abort_bash`.
Pass Pi's flag that keeps a command's output out of the model context.

Verification:

- Cover a command that succeeds, one that fails, one stopped with
  `abort_bash`, and output kept out of context against the Pi fixture.

### 2.116 Composer shell commands

Status: planned
Blocked by: 2.115

Run `!command` and `!!command` from the composer instead of sending them to the
model, show each command and its streamed output in the transcript, and stop a
running command with Escape. `!!` output stays out of the model context.

Verification:

- Component-test `!` and `!!` commands, streamed output, a failed command, and
  stopping one with Escape.
- Run a shell command from a self-hosted session.

### 2.238 Interrupt clears the queue

Status: planned
Blocked by: none

Send `clear_queue` before `abort` when interrupting a Pi session, as Pi's own
Escape does, and return the cleared steering and follow-up text.

Verification:

- Cover an interrupt with queued messages, an interrupt with an empty queue,
  and a failed `clear_queue` against the Pi fixture.

### 2.239 Interrupted queue returns to the composer

Status: planned
Blocked by: 2.238

Put the text of queued messages back in the composer after an interrupt, so
none of it runs or is lost.

Verification:

- Component-test interrupting with queued messages, with an empty queue, and
  with a draft already in the composer.

### 2.240 Retry without a duplicate prompt

Status: planned
Blocked by: none

Retry a failed turn without writing a second copy of its prompt to the session
file. If Pi offers no way to do that over RPC, replace the manual retry control
with a clearly labelled send-again action and rely on Pi's automatic retry.

Verification:

- Cover retrying a failed turn against the Pi fixture and confirm the session
  file holds the prompt once.

### 2.241 Model thinking levels API

Status: planned
Blocked by: none

Report the current model's thinking levels from Pi's
`get_available_thinking_levels` command and refresh them when the model
changes.

Verification:

- Cover a reasoning model, a model without thinking levels, and a model change
  against the Pi fixture.

### 2.242 Model-aware thinking levels

Status: planned
Blocked by: 2.241

Offer only the current model's thinking levels in the thinking-level picker and
in Shift+Tab cycling.

Verification:

- Component-test a model with a subset of levels, a model without thinking
  levels, and a model change while the picker is open.

### 2.167 Transcript history details

Status: planned
Blocked by: none

Show compaction summaries loaded from Pi's history as compaction markers, and
show images attached to user prompts in the transcript.

Verification:

- Component-test a history with a compaction summary and a user prompt with an
  image, both from history and from live events.

### 2.121 Pi transcript export API

Status: planned
Blocked by: none

Expose transcript export through the desktop API.

Verification:

- Cover export and export failure against fixture Pi session files.

### 2.122 Transcript export

Status: planned
Blocked by: 2.121

Add transcript export to the session view.

Verification:

- Component-test export and export failure.
- Export a self-hosted Pi session.

### 2.233 External links

Status: planned
Blocked by: none

Open links from transcripts and other views in the operator's default browser
from the desktop app.

Verification:

- Component-test that a transcript link asks the desktop shell to open it, and
  that unsafe schemes are refused.
- Open a link from a self-hosted session transcript.
