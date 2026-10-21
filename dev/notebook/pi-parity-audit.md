# Pi parity audit

This audit compares Pi 1.0.0's interactive and RPC capabilities with the
controls Pau implements on 2026-10-18 (Pau at `3e98cc5`). It is the first
verification step of unit 2.40.

Pi sources are the docs and `dist/` type definitions under
`~/.pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/`:
`docs/keybindings.md`, `docs/slash-commands.md`, `docs/usage.md`,
`docs/sessions.md`, `docs/rpc-commands.md`, `docs/rpc-extension-ui.md`,
`docs/mcp.md`, and `dist/modes/rpc/rpc-types.d.ts`. Pau sources are the code:
`crates/pi`, the routes in `crates/server/src/lib.rs`, `packages/ui/src/lib`,
and `apps/desktop/src`. Roadmap status was not used as evidence.

## How to read the tables

Each row names one Pi capability with its default key, slash command, or RPC
command, then the Pau control that provides it.

- Supported: a Pau control reaches the same behavior. The code path was traced
  from the component through the desktop API and server route to the RPC
  command.
- Partial: Pau covers the common case but differs from Pi in a way a Pi user
  can notice.
- Missing: Pi RPC or the session file allows it, but Pau has no control.
- Not applicable: the capability belongs to the terminal or to Pi's own
  account and sharing services. The vanilla Pi section lists those that still
  matter.

Notes name the roadmap unit that covers a gap, or say "No unit". Rows for Pi's
built-in slash commands say "pending 2.185" for the typed command, because unit
2.185 is mapping them to Pau actions in parallel. Until it lands, a built-in
command typed in the composer goes to Pi as plain prompt text. Pi RPC does not
run built-in commands, so the model receives that text.

Pi reads its own `settings.json` and `keybindings.json` in RPC mode. A setting
without a Pau control still applies to Pau sessions when it is set in the file
or in vanilla Pi.

## Composer and prompts

| Pi capability                                                                               | Pau control                                                                   | Status         | Notes                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send prompt (`Enter`, RPC `prompt`)                                                         | Composer in `SessionView`, `POST /api/sessions/{id}/prompt`                   | Supported      | Cmd+Enter and Ctrl+Enter also send unless a Pi binding claims them (`composer-keys.ts`).                                                                                                           |
| New line (`Shift+Enter`, `Ctrl+J`)                                                          | Composer, `tui.input.newLine` binding                                         | Supported      |                                                                                                                                                                                                    |
| Prompt history (`Up`/`Down` at the draft edges)                                             | Composer, `GET /api/sessions/{id}/history` from `get_entries`                 | Supported      |                                                                                                                                                                                                    |
| `@` file search                                                                             | `MentionCompletion`, `GET /api/workspaces/{id}/search`                        | Supported      |                                                                                                                                                                                                    |
| `Tab` path completion                                                                       | Tab accepts an open `@` or `/` completion only                                | Partial        | Plain path completion without `@` is absent. No unit.                                                                                                                                              |
| Extension, prompt template, and skill commands (`/name`, `/skill:name`, RPC `get_commands`) | `CommandCompletion`, `GET /api/sessions/{id}/commands`, sent through `prompt` | Supported      | Pi expands templates and skills and runs extension commands.                                                                                                                                       |
| Built-in command completion                                                                 | `CommandCompletion` lists `get_commands` only                                 | Missing        | Pending 2.185.                                                                                                                                                                                     |
| External editor (`Ctrl+G`)                                                                  | None                                                                          | Missing        | 2.189, blocked by 2.67. The composer is already a multi-line field.                                                                                                                                |
| Emacs-style editing (`Ctrl+A/E/K/U/W/Y`, word moves)                                        | Native text field keys                                                        | Partial        | macOS text fields handle most of these. `Alt+Y` yank-pop, `Ctrl+]` jump, and `Ctrl+-` undo are absent. Pau yields its own shortcuts to any chord a Pi binding uses (`resolveKeyActions`). No unit. |
| Clear editor (`Ctrl+C`), exit (`Ctrl+D`), suspend (`Ctrl+Z`)                                | None                                                                          | Not applicable | Terminal process controls. Stop in the session header ends the Pi process.                                                                                                                         |

## Queue and steering

| Pi capability                                                                     | Pau control                                                                      | Status    | Notes                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| Steer while running (`Enter`, RPC `steer`)                                        | Composer queue selector set to Steer, `prompt` with `streamingBehavior: "steer"` | Supported |                                                                            |
| Follow-up (`Alt+Enter`, RPC `follow_up`)                                          | `Alt+Enter`, or the queue selector set to Follow up                              | Supported |                                                                            |
| Show queued messages                                                              | Queued messages list above the composer, `GET /api/sessions/{id}/queue`          | Supported |                                                                            |
| Restore queue to editor (`Alt+Up`, RPC `clear_queue`)                             | `Alt+Up` in the composer, `DELETE /api/sessions/{id}/queue`                      | Supported |                                                                            |
| Steering and follow-up delivery modes (`set_steering_mode`, `set_follow_up_mode`) | None                                                                             | Missing   | Pi's settings file still applies. Planned for the Sessions group of 2.181. |

## Interrupt and retry

| Pi capability                                              | Pau control                                                                 | Status    | Notes                                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interrupt (`Escape`, RPC `abort`)                          | `Escape` in the composer while running, `POST /api/sessions/{id}/interrupt` | Partial   | Pi's TUI clears the queue, aborts, and puts queued text back in the editor. Pau sends only `abort`, so Pi then runs the queued messages. No unit. |
| Automatic retry of transient errors (RPC `set_auto_retry`) | Countdown notice in `SessionView` from `auto_retry_start` events            | Partial   | `PUT /api/sessions/{id}/auto-retry` exists, but no UI calls it. Pi's setting applies. 2.181 covers settings.                                      |
| Cancel a pending retry (`Escape`, RPC `abort_retry`)       | Cancel retry in the retry notice, `DELETE /api/sessions/{id}/retry`         | Supported |                                                                                                                                                   |
| Retry a failed turn                                        | Retry on the failed reply, `POST /api/sessions/{id}/retry`                  | Supported | Pi RPC has no retry command, so Pau resends the last prompt. The prompt appears twice in the session file.                                        |

## Models and thinking

| Pi capability                                                      | Pau control                                                                   | Status         | Notes                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model selector (`Ctrl+L`, RPC `get_available_models`, `set_model`) | `ModelPicker`, `Ctrl+L` from the composer, `PUT /api/sessions/{id}/model`     | Supported      | Pau allows a change only while idle.                                                                                                                                            |
| `/model [provider/model]`                                          | `ModelPicker`                                                                 | Supported      | Typed command with an argument pending 2.185.                                                                                                                                   |
| Cycle models (`Ctrl+P`, `Shift+Ctrl+P`, RPC `cycle_model`)         | None                                                                          | Missing        | No unit.                                                                                                                                                                        |
| Scoped models (`/scoped-models`)                                   | None                                                                          | Missing        | Edit `settings.json` or use vanilla Pi. No unit.                                                                                                                                |
| Save default model or thinking level (`Ctrl+S` in selectors)       | None                                                                          | Missing        | 2.181 links to Pi's settings file instead.                                                                                                                                      |
| Thinking level (`/thinking`, RPC `set_thinking_level`)             | `ThinkingLevelPicker`, `PUT /api/sessions/{id}/thinking-level`                | Partial        | The picker lists a fixed set of levels. It does not read `get_available_thinking_levels`, so a model can show levels it does not support. Typed command pending 2.185. No unit. |
| Cycle thinking (`Shift+Tab`, RPC `cycle_thinking_level`)           | `Shift+Tab` in the composer, cycling client side through `set_thinking_level` | Supported      | Uses the same fixed list.                                                                                                                                                       |
| Provider login (`/login`, `/logout`)                               | None                                                                          | Not applicable | Pi owns credentials. Use vanilla Pi in Pau's terminal. 2.182 and 2.183 report readiness.                                                                                        |
| llama.cpp router (`/llama`)                                        | None                                                                          | Not applicable | Terminal panel. Use vanilla Pi.                                                                                                                                                 |

## Sessions

| Pi capability                                                                  | Pau control                                                                                                                 | Status         | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New session (`/new`, RPC `new_session`)                                        | `Cmd+N` (`session.new`), workspace context menu, `SessionPicker`                                                            | Supported      | Pau starts a new Pi process instead of sending `new_session`. Typed command pending 2.185.                                                                                                                               |
| Resume (`/resume`, `pi --resume`)                                              | `SessionPicker`, `GET /api/workspaces/{id}/pi-sessions`, started with `--session`                                           | Partial        | The picker lists and opens saved sessions but has no search, sort, named filter, rename, or delete. The rail lists the three newest. Typed command pending 2.185.                                                        |
| Continue the most recent session (`pi --continue`)                             | First entry in `SessionPicker`, sorted by modification time                                                                 | Supported      |                                                                                                                                                                                                                          |
| Name (`/name`, RPC `set_session_name`)                                         | Rename in the session context menu, `PUT /api/sessions/{id}/name`                                                           | Supported      | Typed command pending 2.185.                                                                                                                                                                                             |
| Session info (`/session`, RPC `get_session_stats`)                             | `ContextMeter` details, `GET /api/sessions/{id}/usage`; Copy session ID in the context menu                                 | Partial        | Shows context, tokens, and cost. The session file path and message count are not shown. Pending 2.185.                                                                                                                   |
| Clone (`/clone`, RPC `clone`)                                                  | Clone in the session context menu, `POST /api/sessions/{id}/clone`                                                          | Supported      | Typed command pending 2.185.                                                                                                                                                                                             |
| Fork from a user message (`/fork`, RPC `fork`)                                 | Branch from here in a user message's context menu, and the branch action in `SessionTree`; `POST /api/sessions/{id}/branch` | Supported      | The message text returns to the composer, as in Pi. Typed command pending 2.185.                                                                                                                                         |
| Tree view (`/tree`, RPC `get_tree`)                                            | `SessionTree` tab, `GET /api/sessions/{id}/tree` read from the session file                                                 | Supported      | Folding and long-run collapse work. Typed command pending 2.185.                                                                                                                                                         |
| Move within the tree in place (`/tree` selection)                              | None. Branching always creates a new session file through `fork`                                                            | Partial        | Pi RPC has no tree navigation command. Extension commands can call `navigateTree`, so a Pau helper extension or an upstream RPC command could provide it. Branch summaries on leaving a branch are also absent. No unit. |
| Tree labels and filters (`Shift+L`, `Shift+T`, `Ctrl+D/T/U/L/A/O` in the tree) | None                                                                                                                        | Missing        | No RPC command writes labels. No unit.                                                                                                                                                                                   |
| Import a JSONL session (`/import`)                                             | None                                                                                                                        | Not applicable | Use vanilla Pi. Pending 2.185 for the explanation.                                                                                                                                                                       |
| Quit (`/quit`)                                                                 | Stop in the session header, `DELETE /api/sessions/{id}`                                                                     | Supported      | Typed command pending 2.185.                                                                                                                                                                                             |

## Compaction

| Pi capability                                                | Pau control                                                                                 | Status    | Notes                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| Manual compaction (`/compact [instructions]`, RPC `compact`) | Compact in the session header with optional instructions, `POST /api/sessions/{id}/compact` | Supported | Typed command pending 2.185.                                                                      |
| Automatic compaction progress                                | Compaction marker and state from `compaction_start` and `compaction_end`                    | Supported |                                                                                                   |
| Toggle automatic compaction (RPC `set_auto_compaction`)      | None                                                                                        | Missing   | `PUT /api/sessions/{id}/auto-compaction` exists, but no UI calls it. Pi's setting applies. 2.181. |
| Compaction summaries in resumed history                      | Live markers only                                                                           | Partial   | Markers loaded from history are 2.167.                                                            |

## Transcript

| Pi capability                                                                  | Pau control                                                                     | Status         | Notes                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| Search (`Ctrl+Shift+F`, next and previous match)                               | `TranscriptSearch` on `Cmd+F`, `GET /api/sessions/{id}/search`                  | Supported      | Arrows and Enter move between matches.                        |
| Jump between prompts (`Ctrl+Shift+Up/Down`)                                    | `prompt.previous`, `prompt.next`                                                | Supported      |                                                               |
| Scroll and follow output (`PageUp`, `End`)                                     | Native scrolling; Jump to latest and `Ctrl+End`                                 | Supported      |                                                               |
| Expand tool output (`Ctrl+O`)                                                  | `Ctrl+O` toggles every tool block; each block has a disclosure                  | Supported      |                                                               |
| Toggle thinking blocks (`Ctrl+T`)                                              | Per-block disclosure only                                                       | Partial        | No shortcut toggles all thinking blocks. No unit.             |
| Copy last assistant message (`Ctrl+X`, `/copy`, RPC `get_last_assistant_text`) | Copy button and Copy message or Copy as Markdown in each message's context menu | Partial        | No shortcut copies the last reply. Pending 2.185 for `/copy`. |
| Copy code and tool output                                                      | `CopyButton` in `MarkdownBlock` and `ToolOutput`                                | Supported      |                                                               |
| Export HTML or JSONL (`/export`, RPC `export_html`)                            | None                                                                            | Missing        | 2.121 and 2.122. Pending 2.185 for the typed command.         |
| Share (`/share`)                                                               | None                                                                            | Not applicable | Uploads to Radius or a GitHub gist. Use vanilla Pi.           |
| Images in user prompts from history                                            | Live prompts only                                                               | Partial        | 2.167.                                                        |
| Debug dump (`/debug`)                                                          | Diagnostics view and export, `/api/diagnostics`                                 | Not applicable | Pi writes terminal render state. Pau has its own diagnostics. |

## Images and files

| Pi capability                          | Pau control                                                        | Status    | Notes                                                  |
| -------------------------------------- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------ |
| Paste an image (`Ctrl+V`)              | Composer paste, `composer-images.ts`, sent as `images` on `prompt` | Supported | PNG, JPEG, GIF, and WebP up to 10 MiB per request.     |
| Drag an image in                       | Composer drop target                                               | Supported | Rejects unsupported files before the drop.             |
| Pick an image file                     | Image file input in the composer                                   | Supported | No Pi equivalent.                                      |
| Paste copied files on macOS (`Ctrl+V`) | None                                                               | Missing   | Pau ignores pasted files that are not images. No unit. |

## Shell commands

| Pi capability                                                                        | Pau control                     | Status    | Notes                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------- | --------- | -------------------------------------------------------------- |
| Run a command and send its output (`!cmd`, RPC `bash`)                               | None                            | Missing   | 2.115 and 2.116. A `!` draft goes to the model as prompt text. |
| Run a command without sending output (`!!cmd`, RPC `bash` with `excludeFromContext`) | None                            | Missing   | 2.115 and 2.116.                                               |
| Stop a running command (RPC `abort_bash`)                                            | None                            | Missing   | 2.115 and 2.116.                                               |
| Persistent shell                                                                     | Terminal view, `/api/terminals` | Supported | Not a Pi feature. Output does not reach the session.           |

## Extensions and extension UI

| Pi capability                                                                     | Pau control                                                                       | Status         | Notes                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dialogs: `select`, `confirm`, `input`, `editor`                                   | `ExtensionUi` dialog, `POST /api/sessions/{id}/extension-ui/{request_id}`         | Supported      | Pi's timeouts close the dialog with an explanation.                                                                                                                                                                |
| `notify`, `setStatus`, string `setWidget`                                         | `ExtensionUi` notifications, status line, and widgets above or below the composer | Supported      |                                                                                                                                                                                                                    |
| `set_editor_text`, `pasteToEditor`                                                | Ignored in `crates/server/src/sessions.rs`                                        | Missing        | An extension cannot fill the composer. No unit.                                                                                                                                                                    |
| `setTitle`                                                                        | Ignored                                                                           | Missing        | Low impact. No unit.                                                                                                                                                                                               |
| `custom()` components, footer, header, editor replacement, autocomplete providers | None                                                                              | Not applicable | Pi returns `undefined` or does nothing in RPC mode and sends no request, so Pau cannot detect the call. Pau shows its "Terminal-only extension interface" dialog only for unknown request methods. Use vanilla Pi. |
| Open vanilla Pi from that dialog                                                  | `onOpenPiTerminal` prop on `SessionView`                                          | Partial        | The desktop app does not pass the prop, so the dialog has no Open Pi in terminal button. Open the Terminal view and run `pi --session <file>`. No unit.                                                            |
| Reload resources (`/reload`)                                                      | None                                                                              | Missing        | Restart the session. Pending 2.185. Pau's MCP enable and disable path sends `/reload` as a prompt, but Pi documents that built-in commands do not run through `prompt`; this was not verified.                     |
| Extension errors (`extension_error` event)                                        | None found                                                                        | Missing        | No Pau code reads this event. Uncertain whether it reaches diagnostics another way. No unit.                                                                                                                       |

## MCP

| Pi capability                                 | Pau control                                                                               | Status    | Notes                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP tools in a session                        | Tool calls render like other tools in `ToolCallView`                                      | Supported | Pi or `pi-mcp-adapter` owns connections. MCP permission requests are 2.94.                                                                                                                               |
| Server management (`/mcp`, `pi mcp add/list`) | `McpConfigurationView` in `packages/ui`, `run_pi_mcp_operation` in `crates/pi/src/mcp.rs` | Partial   | Neither is reachable from the desktop app: no server route calls them, and the Resources item in the product rail has no view. The adapter's terminal panel is not parsed by design. Nearest unit: 2.34. |
| OAuth sign-in (`/mcp-auth`, `/mcp` panel)     | Typing the adapter command in the composer                                                | Partial   | Uncertain whether the flow completes without the terminal panel.                                                                                                                                         |
| Built-in Pi 1.0 MCP versus `pi-mcp-adapter`   | Pau targets adapter 2.37 and 2.38 commands                                                | Partial   | Pi 1.0 also ships built-in MCP with its own `/mcp`. Which one Pau drives depends on the operator's install. No unit.                                                                                     |

## Keybindings

| Pi capability                         | Pau control                                                                | Status    | Notes                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| Custom bindings in `keybindings.json` | `GET /api/pi/keybindings`; composer actions follow the operator's bindings | Supported | Covers interrupt, submit, new line, follow-up, dequeue, thinking cycle, and model select. |
| Show shortcuts (`/hotkeys`)           | `KeyboardShortcuts` on `Cmd+/`, and the command palette                    | Supported | Typed command pending 2.185.                                                              |
| Other `app.*` and `tui.*` actions     | Mapped where a row above says so                                           | Partial   | Unmapped actions keep their chord free in Pau but do nothing.                             |

## Settings and resources

| Pi capability                                 | Pau control                                          | Status         | Notes                                                         |
| --------------------------------------------- | ---------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| Settings (`/settings`)                        | Settings item in the product rail has no view        | Missing        | 2.181. Edit `settings.json` or use vanilla Pi. Pending 2.185. |
| Fullscreen or regular TUI mode, themes        | Pau's five themes and motion setting                 | Not applicable | Pi's theme API returns nothing in RPC mode.                   |
| Project trust (`/trust`)                      | None                                                 | Not applicable | Use vanilla Pi.                                               |
| Changelog (`/changelog`), bug report (`/bug`) | None                                                 | Not applicable | Use vanilla Pi.                                               |
| Skills, prompt templates, packages            | Commands run from the composer; no browser or editor | Partial        | 2.34, 2.129, 2.130, 2.131, and 2.36 to 2.138.                 |

## Gaps that block daily use

These are Missing or Partial rows that a Pi user hits in routine work and that
no unit in the dogfood gate (2.40 and its blockers 2.156, 2.185, 2.235, 2.237)
covers.

- Shell commands. `!cmd` and `!!cmd` are missing, and a `!` draft reaches the
  model as a prompt. Suggested unit: make 2.115 and 2.116 block 2.40, with
  `bash`, `abort_bash`, and output in the transcript.
- Interrupt semantics. Escape aborts but Pi then runs the queued messages.
  Suggested unit: "Interrupt restores the queue", sending `clear_queue` before
  `abort` and returning the text to the composer.
- In-place tree navigation. Every branch creates a new session file, and branch
  summaries are lost. Suggested unit: "Tree navigation in place", through a Pau
  helper extension command that calls `navigateTree`, or an upstream RPC
  command.

## Capabilities that need vanilla Pi in Pau's terminal

Run `pi` or `pi --session <file>` in Pau's terminal for these. Pi RPC either
lacks the command or the feature draws on the terminal directly.

| Capability                                                                                                        | Reason                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Extension `custom()` components, custom footers, headers, editors, working indicators, and autocomplete providers | RPC mode turns them into no-ops and sends no request.                     |
| `onTerminalInput` handlers and terminal paste handling                                                            | They read raw terminal input.                                             |
| Extension theme switching                                                                                         | `setTheme` fails in RPC mode.                                             |
| `/login`, `/logout`                                                                                               | Interactive provider authentication flows in the TUI.                     |
| `/mcp` panel and `/llama` panel                                                                                   | Terminal-only panels. Pau does not parse them.                            |
| `/share`, `/bug`, `/changelog`, `/trust`, `/import`                                                               | Built-in TUI commands with no RPC equivalent.                             |
| `/scoped-models` and saving defaults from selectors                                                               | TUI selectors with no RPC equivalent. Editing `settings.json` also works. |
| Tree labels and filters                                                                                           | No RPC command writes labels.                                             |

Before using vanilla Pi on a session that Pau has open, stop it in Pau. Pi has
no session lock, and two writers fork the file; see
[pi-session-handoff.md](pi-session-handoff.md).
