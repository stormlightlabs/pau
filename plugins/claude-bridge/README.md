# Pau Claude bridge

`@stormlightlabs/pau-claude-bridge` provides the versioned process protocol used
between the Claude bridge and its clients. The package is usable without the Pau
desktop application.

The package exports Claude Code discovery, process lifecycle control, and the
protocol codec. Its fixtures and fake Claude executable support integration
tests without launching a paid Claude session.

## Claude discovery

`discoverClaude()` accepts an optional `executablePath`. When that option is
absent, it searches `PATH` for `claude`. A configured path takes precedence and
must name an executable file.

Discovery runs `claude --version`; it does not start a Claude session. This
release supports Claude Code versions 1.x and 2.x. Discovery rejects missing or
non-executable files, unrecognized version output, failed version commands, and
unsupported versions with a `ClaudeDiscoveryError` and a machine-readable
`code`.

## Process lifecycle

Create a `ClaudeProcessRegistry`, then pass a discovery result and working
directory to `registry.start()`. The registry starts Claude without a shell, so
spaces in the executable path and working directory do not require quoting.
Claude uses structured stream JSON on stdin and stdout. Stderr remains a
separate diagnostic stream.

A process reports `starting`, `running`, `stopping`, `stopped`, or `failed`.
Its `exit` promise and `exitInfo` property distinguish a requested shutdown from
an unexpected exit and retain the exit code or signal. Exited processes are
removed from the registry.

Call `process.prompt(task, handlers)` to send one task. The `onEvent` handler
receives ordered `text.delta`, `tool.started`, `tool.completed`, and
`turn.completed` events while Claude runs. The returned promise settles when
Claude emits its `result` record; that record determines whether the turn
completed or failed. A process accepts one active prompt at a time.

Call `process.interrupt()` to stop the active turn without stopping Claude. The
promise resolves after Claude acknowledges the interrupt and emits the turn's
authoritative result. Both the interrupt call and the active `prompt()` resolve
with `status: "interrupted"`. The process remains available for another prompt.
An ignored interrupt rejects with `code: "interrupt_timeout"`; a child-process
exit rejects the prompt with `code: "process_exited"` instead of reporting an
interruption.

Use `onDiagnostic` to receive stderr as diagnostic frames. Plain stderr and
structured diagnostics stay separate from prompt events and never enter the
protocol stream.

A completed turn exposes Claude's native identifier as `sessionId` and stores it
on `process.nativeSessionId`. After stopping that process, call
`registry.resume()` with the identifier to let Claude load its native session.
The bridge does not copy or store the transcript. If Claude cannot find the
identifier or reports a different one, the next prompt rejects with a
recoverable `ClaudeResumeError`.

Call `process.stop()` for a staged shutdown. The bridge closes structured input,
then sends `SIGINT`, `SIGTERM`, and `SIGKILL` if each preceding step times out.
`registry.stopAll()` applies the same shutdown to every live process.

## Pi extension

The package registers these commands:

- `/claude-discover` finds Claude without starting a session.
- `/claude-start [profile]` starts a session. The default profile is `work`.
- `/claude-new [profile]` stops Claude and starts a new native session.
- `/claude-resume [id] [profile]` resumes a native session. The ID is optional
  when the current Pi session has recorded one.
- `/claude-work <task>` runs focused work.
- `/claude-review <task>` runs a review without command or file-write tools.
- `/claude-review-checks <task>` runs a review with allowlisted checks.
- `/claude-status`, `/claude-interrupt`, and `/claude-stop` control the current
  process.
- `/claude-delegation enable|disable` controls the `claude_delegate` tool. The
  tool starts disabled in every Pi session.

One Pi session owns one current Claude process. Pi stores only Claude's native
session ID. Reloading or exiting Pi stops the process; after a restart, use
`/claude-resume` before continuing the native session.

The `work` profile uses Claude's automatic edit permission mode. The direct
stream transport cannot forward permission dialogs to Pi, so Claude denies any
request that still needs operator input. The `review` profile disables command
and write tools. `review-with-checks` enables only the commands listed in
`PAU_CLAUDE_CHECK_COMMANDS`, separated by semicolons. Its default list covers
common status, diff, and test commands. These controls are guardrails, not a
sandbox.

The extension reads this configuration when Pi loads it:

- `PAU_CLAUDE_PATH` selects the executable.
- `PAU_CLAUDE_CONFIG_MODE=native|safe` selects native Claude configuration or
  disables settings, plugins, hooks, and configured MCP servers. Native mode is
  the default.
- `PAU_CLAUDE_MAX_TURNS` sets the finite turn limit. The default is `20`.
- `PAU_CLAUDE_MAX_BUDGET_USD` sets an optional dollar budget.
- `PAU_CLAUDE_CHECK_COMMANDS` sets the semicolon-separated check allowlist.

Claude keeps ownership of authentication, model selection, and effort. The
extension reports Claude's turn count and cost when they are present in the
result record. Model-facing results are limited to 8,000 characters; tool
activity remains visible through Pi's tool updates.

## Wire format

Each stream uses newline-delimited JSON (JSONL). A frame occupies one line and
ends with `\n`; readers also accept `\r\n`. Every frame has `version: 1` and one
of these types:

- `command` sends a named operation and a non-empty correlation ID.
- `response` completes a command with the same ID and either a result or a
  structured error.
- `event` reports an ordered bridge event with a non-negative sequence number.
- `diagnostic` reports bridge or child-process information with a severity.

Commands, responses, and events use the protocol stream. Diagnostics use a
separate diagnostic stream. A stdio bridge writes protocol frames to stdout and
diagnostic frames to stderr. Consumers must never parse stderr as protocol
output or write diagnostics to stdout.

Unknown versions and invalid records produce a decode error for that line. The
decoder resumes at the next newline, so a bad record does not consume the next
valid frame.

## Development

Run the package checks from this directory:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The tests round-trip every frame type, replay malformed and unsupported fixture
records, and run `test/fixtures/fake-claude.mjs` as a child process. Prompt
fixtures include partial records, streamed text, tool activity, diagnostics,
successful, failed, and interrupted completion states; ignored interrupts;
process crashes; follow-up prompts; and native session resume. The fake
executable emits protocol data on stdout and diagnostics on stderr.

## License

This package is available under either the MIT License or the Apache License
2.0.
