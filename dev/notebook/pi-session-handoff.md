# Pi session handoff research

This note covers moving one Pi session between Pau and Pi's terminal UI in both
directions. The move can lose live state, but it must never lose or fork
history by accident.

The short answer: Pi's session file already carries everything durable, so a
handoff is "stop one writer, start the other on the same file." Pi has no
session lock, and two writers silently fork the tree, so Pau must enforce a
single writer itself. A small Pau-owned Pi extension makes Pi-to-Pau handoff
exact; without it, Pau can only guess whether a terminal Pi has the session
open.

Sources are the Pi 1.0.0 docs and `dist/` under
`~/.pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/`
(written below as `pi/docs/…` and `pi/dist/…`), Pau's code at `ed4a385`, and
experiments with an isolated Pi (`PI_CODING_AGENT_DIR` pointed at an empty
scratch directory, `PI_OFFLINE=1`, no prompts).

## What Pi does with a session file

### Storage and lookup

Pi stores a session as JSONL at
`<sessionDir>/--<encoded cwd>--/<timestamp>_<id>.jsonl`
(`pi/docs/session-format.md`). Entries form a tree through `id` and `parentId`.
Messages, model and thinking changes, compactions, branch summaries, context
edits, labels, session names, usage, and extension entries are all entries in
that file. No session state lives elsewhere.

`pi --session <path|id>` opens a file by path or by exact or partial ID,
searching the current project first. `pi --continue` opens the most recently
modified session for the cwd, and `pi --resume` or `/resume` opens the picker
(`pi/docs/cli.md`, `pi/docs/sessions.md`). The picker and `--continue` sort by
file mtime or last activity (`pi/dist/core/session-manager.js:452`, `:585`).

### Writes

`SessionManager` (`pi/dist/core/session-manager.js`) reads the whole file once
when a session opens (`loadEntriesFromFile`, `:325`) and keeps every entry in
memory. After that it only appends:

- `_persist` appends each new entry with `appendFileSync`, one JSON line per
  call (`:794`–`:814`). Pi opens and closes the file for each write and never
  holds it open. An `lsof` probe against a live `pi --mode rpc` confirmed that
  the session file is not among its open files.
- Every new entry's `parentId` is the in-memory leaf (`:831` onward). The leaf
  is in-memory state.
- Full rewrites happen only when a file is created, when an empty file is
  initialized, and when a legacy-version file is migrated on load (`:678`,
  `:723`, `:754`). Compaction appends a `compaction` entry and does not rewrite
  history (`pi/docs/compaction.md`, `pi/docs/session-format.md`).

On load, the leaf becomes the last entry in file order (`_buildIndex`, `:732`).
Moving the leaf with `/tree` and no summary changes only memory (`branch()`,
`:1161`), so that position is lost when the process exits unless something is
appended after it.

Opening a session can itself write. When the active branch has no
`thinking_level_change`, Pi appends one at startup (`pi/dist/core/sdk.js:279`).
The experiment below shows both an RPC process and a later reader doing this.

### No locking and no reload

Pi uses `proper-lockfile` for auth, settings, trust, and package updates, but
not for sessions (grep of `pi/dist` for `lockfile`). Neither the TUI nor RPC
mode watches the session file: the only file watchers in interactive mode
follow Git state for the footer (`pi/dist/core/footer-data-provider.js`). A
running Pi never sees entries another process appends.

### The process is hard to identify from outside

Pi sets `process.title = "pi"` in both interactive and RPC mode
(`pi/dist/cli/setup.js:4`). On macOS this overwrites the visible argv: `ps`
showed a live `pi --mode rpc --session <file>` as just `pi`, with no
arguments. Node implements the title through libuv, which rewrites argv memory
on Linux too, so `/proc/<pid>/cmdline` should also read `pi`. This was not
checked on Linux. The process cwd stays readable through `lsof -d cwd` or
libproc on macOS and `/proc/<pid>/cwd` on Linux. A process scan can therefore
say "a Pi process runs in this directory," but not which session it has open.
`--continue`, `/resume`, and `/new` never put the session in argv anyway.

`PI_SESSION_FILE` exists only in the environment of commands Pi's tools run
(`pi/docs/environment-variables.md`), not in Pi's own environment.

## Experiment: two writers on one file

A scratch script wrote a three-line fixture session (header,
user message, assistant message), started two `pi --mode rpc --session
fixture.jsonl` processes, and then:

1. A set the name `from-A`. B set the name `from-B`.
2. A read its state and still reported `from-A`.
3. A set the thinking level to `high`. Both exited.
4. A third process opened the file and read state and tree.

The file after step 3:

```text
header
aaaa0001 user
aaaa0002 assistant        (parent aaaa0001)
ac1bae78 thinking medium  (parent aaaa0002)   A, appended on open
90b59e4b name from-A      (parent ac1bae78)   A
3028663f thinking medium  (parent aaaa0002)   B, appended on open
d49a6ac6 name from-B      (parent 3028663f)   B
1be7835e thinking high    (parent 90b59e4b)   A
```

The third process reported `thinkingLevel: high` and `sessionName: from-B`. The
tree had two branches under the assistant message, and the leaf was A's last
entry because it was the last line in the file.

What this shows:

- Nothing is corrupted at the line level, and no entry is lost on disk.
- Each writer extends its own branch, so concurrent work forks the tree with no
  branch summary and no notice to either side.
- On the next load, whichever writer appended last owns the active branch. The
  other writer's latest turns end up on a side branch that the model no longer
  sees. A user would experience this as Pi "forgetting" the last few turns.
- The session name comes from the latest `session_info` anywhere in the file,
  not from the active branch (`getSessionName`, `:927`), so metadata can
  disagree with the branch.
- Simply opening the session in a second process wrote an entry.

### Other failure modes

These follow from the code rather than from the experiment:

- A running TUI never learns about Pau's appends. Its context is stale from the
  first Pau turn, and its next turn forks the tree as above.
- Pi writes each entry with one `appendFileSync`. On local APFS and ext4,
  `O_APPEND` writes do not interleave mid-line in practice. On network
  filesystems they can, and Pi skips malformed lines on load (`:320`), which
  would drop entries silently.
- A legacy file migrated on load is rewritten from that process's snapshot,
  which drops anything another process appended in between.
- Entry IDs are 8 hex characters checked only against the writer's own index,
  so two writers could in principle generate the same ID.

## Pau today

- `crates/pi/src/native_sessions.rs` lists and reads session files and never
  writes them. It resolves the directory from `PI_CODING_AGENT_SESSION_DIR` or
  `<agent dir>/sessions` but ignores the `sessionDir` setting
  (`crates/pi/src/lib.rs:140`). A macOS app launched from the Dock also does
  not inherit a shell-profile `PI_CODING_AGENT_SESSION_DIR`, so Pau and a
  terminal Pi can disagree about where sessions live.
- Listing keys on the exact workspace root. A TUI started in a subdirectory
  uses a different cwd directory and does not appear in Pau's picker.
- `start_session` (`crates/server/src/sessions.rs:758`) resolves
  `native_session_id` to a file and launches `pi --mode rpc --session <file>`.
  It does not check whether another live Pau session already holds that file.
  Only the desktop store deduplicates, per window
  (`apps/desktop/src/lib/live-sessions.svelte.ts:599`), so a browser
  development client and the desktop app can start two writers.
- `NativeState` (`sessions.rs:110`) records the native session ID and thinking
  level but not the file. `PiSession::native_session()` already reads
  `sessionFile` from `get_state` (`crates/pi/src/session.rs:262`).
- Branching runs Pi's `fork`, which starts a new native session file
  (`sessions.rs:1237`). RPC has no command that moves the leaf without
  appending, so a Pau-driven session always reopens at the right leaf.
- `stop_session` closes Pi's stdin and escalates through interrupt, terminate,
  and kill (`crates/pi/src/process.rs:318`). Pi writes synchronously, so every
  entry Pi accepted is on disk once the process exits.
- `create_terminal` (`crates/server/src/terminals.rs:162`) accepts an argv and
  runs it in the workspace root, so a terminal can run Pi directly. It has no
  environment field.
- The desktop gets a random port and an in-memory token at launch
  (`apps/desktop/src-tauri/src/main.rs:27`). Nothing outside the app can find
  the API, and Pau has no deep-link handler.
- The spec already sends terminal-only extension components to "vanilla Pi in a
  Pau terminal" (`dev/design/surfaces.md`, Session), and the permission plan
  already restarts Pi on the same session file when the profile changes
  (`dev/plan/backend.md`). Handoff is the general form of both.

## The single-writer rule

At most one Pi process may have a session file open for writing. A handoff
stops the current writer and waits for it to exit before the next one starts.
Every Pi process that opens a session is a writer, because opening can append.

Pau enforces the rule where it can and warns where it cannot:

- Within Pau, enforce it exactly. Key live sessions by canonical session file,
  update the key after fork, clone, switch, and new session, and return the
  existing live session instead of starting a second process.
- Against a Pi started by Pau's handoff, enforce it exactly. Pau knows the
  terminal's PID and file, marks the session "open in Pi" until that process
  exits, and refuses to resume it meanwhile.
- Against a Pi Pau did not start, detect it with a presence record when the
  handoff extension is installed, and fall back to a workspace-level process
  scan otherwise.

### Detection

Presence records are the reliable method. The handoff extension writes
`<pau state dir>/pi-presence/<pid>.json` with the PID, process start time,
session file, session ID, and cwd. It rewrites the record on `session_start`
after `/resume`, `/new`, or `/fork`, and deletes it on `session_shutdown`. Pau
treats a record as live when `kill(pid, 0)` succeeds and the start time
matches. That check survives crashes and PID reuse. `sysinfo`, already a
workspace dependency, reports start time on macOS and Linux.

The process scan is the fallback. List processes named `pi`, exclude Pau's own
children, and compare each cwd with the workspace root. A match means "Pi is
running in this workspace," which is enough for a warning but not for refusal:
another RPC client or an unrelated session in the same directory also
matches. `sysinfo` reads name and cwd on both platforms without shelling out to
`lsof`.

File mtime is a weak hint. An idle TUI does not write, and a recent mtime only
says someone wrote recently. Show it as "modified 20 s ago," not as an
open-elsewhere state.

File locks would not help: Pi does not take them, and Pau must not edit or lock
Pi's files. A native session lease in Pi is the proper fix and is worth raising
upstream.

## Pau to Pi

### Flow

1. The operator chooses Open in Pi from the session header or the command
   palette.
2. If Pi is running, compacting, retrying, or waiting on an extension dialog,
   the confirmation offers Interrupt and open. Interrupt sends `clear_queue`,
   then `abort`, and waits for `agent_settled`, matching Pi's Esc behavior
   (`pi/docs/rpc-commands.md`, `clear_queue`).
3. Pau reads `get_state` for the current `sessionFile`, because a branch may
   have moved the session to a new file.
4. Pau collects text to carry: the cleared queue and the unsent composer draft.
5. Pau stops the RPC process and waits for exit.
6. Pau starts the target:
   - In a Pau terminal tab: the discovered Pi executable with
     `--session <file>`, in the workspace root, with the same environment Pau
     uses for RPC launches. Pau marks the session open in Pi until the
     terminal process exits, then clears the mark so it can be resumed.
   - Elsewhere: Pau copies `cd <root> && pi --session <file>` with shell
     quoting. Pau cannot track that process, so it relies on presence records
     or the process scan after this point.

Use the file path, not the ID. A partial-ID lookup searches the current project
first and offers a cross-project fork on a miss, and the path also works when
the session directory is overridden.

### Carrying text into the TUI

Pi has no flag that fills the editor without sending. Positional messages are
sent as prompts. Two options:

- In a Pau terminal, pass `--extension <handoff extension>` and
  `PAU_HANDOFF_DRAFT_FILE=<0600 temp file>`. On `session_start` the extension
  calls `ctx.ui.setEditorText()` and deletes the file. This needs an `env`
  field on terminal creation.
- Otherwise, copy the text to the clipboard and say so in the confirmation.

### What carries over

Everything in the file:

- every message, tool call, and tool result on every branch
- the tree, including abandoned branches, branch summaries, and labels
- compactions and context edits, so the TUI rebuilds the same model context
- model and thinking level, restored from the active branch's
  `model_change` and `thinking_level_change` entries
- the session name, usage, and cost totals
- extension `custom` and `custom_message` entries. The TUI renders them only
  when the same extension and renderer are loaded.

The leaf is correct because Pau's RPC session cannot move it without
appending. Global Pi settings, such as auto-compaction, live in Pi's settings
files and apply to both sides.

### What is lost

- An in-flight run. Interrupt stops it, and only entries Pi had already written
  remain.
- Queued steering and follow-up messages. They live in Pi's memory. Pau carries
  their text as a draft instead of re-queuing them.
- Pending extension dialogs. They die with the RPC process. Handoff therefore
  requires none to be open, or interrupts the run that raised them.
- Session approvals from the permission extension (2.63). They are in memory
  and do not survive any restart.
- The permission profile. The terminal Pi loads only the operator's own Pi
  configuration, so a session with a confirming profile runs with no prompts.
  Pau can pass the permission extension and policy file to a Pau-terminal
  launch to keep the prompts, but approvals still reset.
- The sandbox. Operator terminals are unsandboxed by default
  (`dev/spec/safety-and-persistence.md`). Pau should refuse Open in Pi for a
  sandboxed session until the terminal launch path supports containment, or
  require an explicit choice that names the loss.
- Pau's per-session MCP override. The terminal Pi uses Pi's own MCP
  configuration.
- UI state: scroll position, inspector, selected tree node, and terminal dock
  layout.

Pau-only metadata keyed by native session ID, such as the archive flag
(2.208), is not lost. It stays in Pau's
database and is simply invisible in Pi.

## Pi to Pau

### Sessions the TUI has closed

These already work. A session the TUI created in the workspace root appears in
Pau's picker, sorted by mtime, and Resume launches Pi with `--session`. The
gaps are the `sessionDir` setting, a GUI-launched app that lacks a
shell-profile session directory, and a TUI started in a subdirectory.

### Sessions the TUI still has open

Pau must not start a second writer. The options, from least to most work:

1. Instructions only. The picker shows "Pi may be running in this workspace"
   from the process scan. Resume warns and asks the operator to quit Pi first.
2. Presence records. The picker shows "Open in Pi" on the exact session, and
   Resume refuses with "Quit Pi in that terminal, or run /pau there." Pau
   never signals a process it did not start: the TUI may be mid-run, and the
   operator may have unsent text in its editor.
3. A `/pau` command in the handoff extension:
   - Refuse unless `ctx.isIdle()` and `!ctx.hasPendingMessages()`. Ask the
     operator to wait or press Esc.
   - If the leaf is not the last entry, because the operator navigated with
     `/tree`, append a `pau-handoff` custom entry with `pi.appendEntry()`. It
     becomes the last line with the current leaf as its parent, so Pau reopens
     at the same place. Custom entries never enter model context.
   - Read `ctx.ui.getEditorText()`.
   - Open `pau://resume?session=<file>&draft=<text>` with `open` on macOS or
     `xdg-open` on Linux, detached.
   - Call `ctx.shutdown()`.

When Pau receives the link, it:

- validates that the file is a session of a registered workspace with
  `find_pi_session_file`, which never joins an identifier into a path, or
  offers to open the header's cwd as a workspace
- waits up to a few seconds for the presence record's PID to exit, and refuses
  if it does not
- resumes the session, or selects it if already live
- fills the composer with the draft without sending it

### Why a deep link and not the loopback API

A deep link starts Pau when it is not running and needs no credentials. Tauri 2
provides it through the deep-link plugin, with the single-instance plugin
forwarding links to the running instance on Linux
(<https://v2.tauri.app/plugin/deep-linking/>). On macOS the scheme registers
from the installed bundle, so it does not work in `tauri dev`. Any local
program or web page can open a `pau://` URL, so Pau treats it as a request:
validate the path, never send text, and show the session before resuming when
the link did not come from a known presence record.

The loopback API would need a discovery file holding the port and token. The
spec requires an unguessable per-launch token for the local API, and writing it
to disk for every local process to read weakens that rule. It also does
nothing when Pau is closed.

A link the extension prints for the operator to click is a fallback for a Pau
build without the scheme.

## Recommended design

1. Enforce single-writer within Pau first. It fixes a real double-writer bug
   today, and every handoff path depends on it.
2. Add a handoff API and Open in Pi. Default to a Pau terminal tab and offer a
   copied command. Require idle, or interrupt with confirmation. Carry queue
   and draft text. Refuse for sandboxed sessions.
3. Add external-Pi detection to the saved-session list: presence records when
   available, then the process scan. Show badges and refuse resume on an exact
   match.
4. Ship a Pau-owned Pi extension, `@stormlightlabs/pau-pi-handoff`, next to
   `packages/pi-permissions`. It writes presence records, provides `/pau`, and
   fills the editor from a handoff draft. Pau loads it with `--extension` in
   the terminals it starts. Operators can install it in their own Pi
   configuration to get presence and `/pau` in any terminal.
5. Add the `pau://resume` deep link last. Without it, `/pau` can still record
   the leaf, exit, and print "Resume this session from Pau's session picker."

UX touchpoints:

- Session header overflow menu: Open in Pi. It is disabled with a reason while
  the session is sandboxed or the connection is down.
- Confirmation dialog: the destination (Pau terminal or copy command), plus a
  short list of what does not move, built from the session's actual state:
  "1 queued message will be placed in Pi's editor," "Session approvals will
  reset," "Pi in the terminal runs without Pau's permission prompts."
- While open in Pi, the session view shows a read-only banner, "Open in Pi in
  terminal 2," with Show terminal and a Resume here action that is enabled
  once that process exits.
- Picker badges: Running (live in Pau), Open in Pi (exact presence or a
  Pau-started terminal), and "Pi is running in this workspace" as a list-level
  note from the process scan.
- Command palette: "Open session in Pi" and "Copy Pi resume command" for the
  current session. "Resume Pi session…" opens the picker. These depend on the
  command palette (2.172).
- Terminal-only extension component notices link to Open in Pi instead of only
  describing vanilla Pi.

## Proposed roadmap units

### 2.NEW-H1 Single-writer Pi sessions

Status: planned
Blocked by: none

Track each live Pau session by its canonical Pi session file and return the
existing session instead of starting a second process on the same file.

Verification:

- Start two resumes of the same saved session through the API and confirm one
  Pi process and one live session.
- Branch, clone, and start a new session against the Pi fixture, then confirm
  the tracked file follows the session and the old file can be resumed.

### 2.NEW-H2 Pi session handoff API

Status: planned
Blocked by: 2.NEW-H1

Stop a live Pi session for handoff, carrying its queued and draft text, and
optionally start Pi in a Pau terminal on the same session file.

Verification:

- Cover an idle handoff, an interrupted run, a cleared queue whose text is
  returned, and a refused sandboxed session against the Pi fixture.
- Confirm the session reports open in Pi until the terminal process exits and
  that resume is refused meanwhile.
- Confirm the returned shell command quotes paths with spaces and quotes.

### 2.NEW-H3 Open in Pi

Status: planned
Blocked by: 2.NEW-H2

Add Open in Pi to the session header, with a confirmation that lists the state
that will not move and a choice between a Pau terminal and a copied command.

Verification:

- Component-test the confirmation for idle, running, queued, permission
  profile, and sandboxed sessions.
- Component-test the open-in-Pi banner and Resume here after the terminal
  exits.
- Hand off a real session in the installed macOS build, continue it in Pi in
  the Pau terminal, quit, and resume it in Pau.

### 2.NEW-H4 External Pi detection

Status: planned
Blocked by: 2.NEW-H1

Report saved sessions that a Pi process outside Pau has open, using presence
records when present and a workspace-level process scan otherwise.

Verification:

- Cover live, stale, and reused-PID presence records with fixtures.
- Cover the process scan with a fixture process named `pi` in the workspace
  root, and confirm Pau's own Pi children are excluded.
- Confirm resume refuses a session with a live presence record and warns on a
  scan match.

### 2.NEW-H5 Open-elsewhere badges

Status: planned
Blocked by: 2.NEW-H4

Show Open in Pi and Pi-running states in the saved-session picker and explain
how to hand the session back.

Verification:

- Component-test each badge and the refused-resume message.

### 2.NEW-H6 Pi handoff extension

Status: planned
Blocked by: none

Ship a Pau-owned Pi extension that writes presence records, fills the editor
from a handoff draft, and adds a `/pau` command that preserves the leaf and
exits Pi.

Verification:

- Cover presence records across start, `/resume`, `/new`, and shutdown with the
  extension test harness.
- Confirm `/pau` refuses while Pi is running or has queued messages.
- Confirm `/pau` after `/tree` navigation reopens at the same leaf in a new Pi
  process.

### 2.NEW-H7 Resume links

Status: planned
Blocked by: 2.NEW-H1, 2.NEW-H6

Register the `pau://resume` link so `/pau` opens the session in Pau with its
draft in the composer.

Verification:

- Cover link validation for a registered workspace, an unregistered cwd, a path
  outside Pi's session directory, and a Pi process that does not exit.
- Run `/pau` from a terminal Pi against the installed macOS build, both with
  Pau running and with it closed.

## Open questions

- Is Pau terminal plus a copied command enough, or should Open in Pi also
  launch the operator's external terminal (Terminal, iTerm2, Ghostty, a
  Zellij tab)? Each needs its own launcher.
- Should Open in Pi for a confirming-profile session pass the permission
  extension and policy file to the terminal Pi, or deliberately hand off a
  vanilla Pi with a warning?
- For sandboxed sessions, refuse outright until a contained terminal exists, or
  allow an explicit unsandboxed handoff?
- Where should presence records live: Pau's state directory (proposed), which
  the extension must locate per platform, or a directory under
  `~/.pi/agent/`, which Pi owns?
- Should operators install the handoff extension in their personal Pi
  configuration, or should Pau load it only into the terminals it starts and
  accept the weaker process scan for other terminals?
- Is a native session lease worth proposing to Pi upstream? It would make
  detection exact for every client and protect TUI-only users as well.
- Should Pau read the `sessionDir` setting and list sessions from workspace
  subdirectories, so every TUI session appears in the picker?
