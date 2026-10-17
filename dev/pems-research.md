# Pi permission extension

This note compares two ways to give Pau its own Pi permission extension:
forking [`@gotgenes/pi-permission-system`][upstream] or writing a Pau extension
that reuses parts of it. Either way, the Pau extension replaces the pinned
package and the event forwarder described in the backend plan.

Measurements come from the upstream repository at commit `fefa477b`
(2026-10-16), which is still release 40.3.0, and from the Pi 1.0.0
documentation and `dist` sources.

[upstream]: https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system

## Recommendation

Write a new Pau-owned extension for the gate, policy, dialogs, session
approvals, and RPC messages. Copy upstream's bash analysis and path modules
unmodified into a vendored directory, with the upstream license and a recorded
source commit, and re-copy them when upstream fixes land.

Pau needs about a third of the package, and the part it needs most, bash
analysis, is the part it should not rewrite. The rest of the package is built
for a terminal user with personal config files, which is the shape Pau has to
undo. A full fork would carry about 21,000 lines Pau does not use and would put
Pau's changes in the files upstream changes most often. A hard fork would make
Pau the owner of a fast-moving bash analyser written by one author, with no
way to take fixes.

## Upstream package size

The 40.3.0 source has 31,522 lines of TypeScript in 172 files. Its tests have
70,092 lines in 202 files. The package does not publish a coverage figure, and
this research did not install or run it. Its `measure:*` scripts measure policy
outcomes against the author's review log, not test coverage.

| Area                                                      | Source lines | Test lines | Pau needs it     |
| --------------------------------------------------------- | -----------: | ---------: | ---------------- |
| `access-intent/bash` (tree-sitter bash analysis)          |        8,043 |     11,718 | Yes, vendored    |
| `access-intent` other (tool kinds, MCP names, path facts) |        1,431 |      2,348 | Partly, vendored |
| `path` (normalization, containment, approval patterns)    |          967 |      2,380 | Yes, vendored    |
| `policy` (rules, wildcards, merge, resolver)              |        1,781 |      8,145 | Ideas only       |
| `session` (session approvals)                             |          651 |      1,343 | Ideas only       |
| `authority` dialog queue and decision chain               |        2,830 |            | Ideas only       |
| `authority` subagent forwarding                           |        3,134 |            | No               |
| `authority` terminal prompt component                     |          588 |            | No               |
| `handlers` (gate pipeline, skill gates, prompt edits)     |        3,096 |     12,731 | Ideas only       |
| `config` (user and project config files, modal)           |        2,854 |      4,672 | No               |
| `presentation` (dialog and agent text)                    |        2,298 |      3,280 | No               |
| `logging` (review log, redaction)                         |        1,000 |      1,563 | No               |
| `exposure` (hide denied tools from the system prompt)     |          717 |      1,152 | No               |
| `service`, root, `tool-input`                             |        2,132 |            | No               |

The `authority` tests total 12,022 lines and are not split by file group.

About 41% of the lines in `access-intent/bash` are comments, so the vendored
analysis is roughly 5,000 lines of code. Its entry point is
`BashProgram.parse(command, normalizer, options)`, which returns the command
units, external path accesses, and path rule candidates for one command. It
imports only its own directory, `path/*`, `access-intent/{effect,access-path,
path-normalization,tool-kind}`, `types.ts`, and two type-only imports from
`config/` (`command-effects-config.ts` and a Zod-inferred type in
`config-schema.ts`).

### Dependencies

| Package            | Version | License | Notes                                              |
| ------------------ | ------- | ------- | -------------------------------------------------- |
| `web-tree-sitter`  | 0.26.9  | MIT     | 4.6 MB unpacked, WASM runtime                      |
| `tree-sitter-bash` | 0.25.1  | MIT     | 20.3 MB unpacked, runs `node-gyp-build` on install |
| `zod`              | 4.4.3   | MIT     | Config schema only                                 |

The vendored code loads `tree-sitter-bash/tree-sitter-bash.wasm` through
`createRequire`. It never uses the native addon, so Pau's build should copy
the WASM file and keep `tree-sitter-bash` out of `allowBuilds`. Zod is needed
only for one type import; a local type definition can replace it without
editing vendored files if Pau keeps the `#src/*` import alias pointing at the
vendored directory.

## Release churn

The repository has 192 tags for the package, from 5.18.2 in May 2026 to 40.3.0
on 2026-10-17, between 24 and 48 releases a month. One author wrote 2,617 of
the commits touching the package. Three other people contributed one commit
each.

| Range            | Dates          | Source change            | Test change              |
| ---------------- | -------------- | ------------------------ | ------------------------ |
| 30.0.0 to 33.0.0 | 09-02 to 09-18 | 142 files, +3,546 −1,193 | 137 files, +7,497 −1,174 |
| 36.0.0 to 37.0.0 | 09-29 to 10-02 | 20 files, +809 −717      | 22 files, +1,514 −1,392  |
| 37.0.0 to 38.0.0 | 10-02          | 15 files, +409 −85       | 12 files, +812 −1        |
| 38.0.0 to 39.0.0 | 10-02 to 10-03 | 16 files, +436 −93       | 22 files, +1,306 −111    |
| 39.0.0 to 40.0.0 | 10-03 to 10-06 | 49 files, +1,411 −315    | 51 files, +3,340 −548    |
| 40.0.0 to 40.3.0 | 10-06 to 10-17 | 45 files, +2,183 −318    | 51 files, +3,860 −90     |

Since 37.0.0, 49 commits touched `access-intent`, 28 touched `policy` and
`path`, and 11 touched `authority`. The 40.x bug fixes are almost all bash
wrapper fixes: `sudo`, `doas`, `env`, `xargs`, `watch`, and `time ( … )` forms
that had earned a read-only exemption or escaped the wrapper floor. Those are
security fixes Pau wants, and they land in the vendored files. Changes to
`authority`, `config`, and `presentation`, where a fork would carry Pau's
changes, made up 13 to 22% of the changed files in each recent range.

## Package and loading

Create `packages/pi-permissions` as `@stormlightlabs/pau-pi-permissions`,
licensed `MIT OR Apache-2.0` like the other packages, with a `pi.extensions`
entry like `packages/claude-bridge`. Keep it private unless it should also be
usable from vanilla Pi. Use Valibot for the policy file and answers.

```text
packages/pi-permissions/
  src/pi-extension.ts      gate, queue, RPC messages
  src/policy.ts            policy file schema and rule matching
  src/session-approvals.ts
  src/vendor/pi-permission-system/
    LICENSE                upstream MIT license, unchanged
    SOURCE.md              upstream URL, commit, version, file list
    access-intent/...      unmodified upstream files
    path/...
  scripts/sync-vendor.mjs  copies the listed files at a given commit
  test/                    Pau tests plus the vendored bash and path tests
```

Pau loads the extension only when a session uses a confirming profile, as it
does for the sandbox extension in `crates/pi/src/sandbox.rs`:

- `--extension <package>/dist/pi-extension.js`, placed before the sandbox
  extension so a denied call never reaches the sandbox's outside-sandbox
  confirmation
- `PAU_PERMISSION_POLICY_FILE=<session host directory>/permissions.json`, a
  `0600` file Pau writes before launch, matching `PAU_SANDBOX_POLICY_FILE`

This closes upstream issue #799 for Pau. The extension reads no file under
`~/.pi` or `<cwd>/.pi`, needs no `--approve`, and changes no other Pi session.
Pau merges user rules and project rules in Rust before writing the file, so a
project can only narrow access and the extension sees one ordered rule list.

The extension reads the file once at `session_start`. To change a profile or
revoke a session approval mid-session, Pau sends an extension command such as
`/pau-permissions reload` through the RPC `prompt` command. Pi runs extension
commands immediately, even while streaming, reports them as `handled`, and
does not add them to the transcript. The model has no tool that sends one.
Pau hides the command from its slash-command list. The extension always denies
writes to its own policy file, and the session host directory belongs on the
protected-path list.

A missing, unreadable, or invalid policy file blocks every gated call with a
reason. This replaces upstream's behavior of asking for everything when its
config is invalid.

## RPC contract

Pi 1.0.0 gives an extension no structured stdout record of its own. Extension
writes to stdout go to stderr, and `entry_appended` persists into the session
file. Dialogs have fixed fields: `select` sends `title`, `options`, and
`timeout`, with no metadata field. Pi does not check a `select` answer against
the options, so the answer string can carry JSON.

Because Pau owns both ends, the extension puts a versioned JSON envelope in the
dialog title. Pau parses it only in sessions it launched with this extension
and never shows the raw title. This is not dialog-text scraping: the envelope
is a schema both sides validate. Asking Pi upstream for a `metadata` field on
dialogs would remove the overloading later.

### Request

The extension calls
`ctx.ui.select(envelope, ["allow_once", "allow_session", "deny"], { signal:
ctx.signal, timeout })`, which Pi sends as:

```json
{
	"type": "extension_ui_request",
	"id": "<pi dialog id>",
	"method": "select",
	"title": "{\"pau\":\"permission\",\"version\":1,...}",
	"options": ["allow_once", "allow_session", "deny"],
	"timeout": 300000
}
```

Envelope fields:

| Field                            | Meaning                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `requestId`                      | Extension-generated ID, also used in decision records                                       |
| `toolCallId`, `parentToolCallId` | Correlate with Pi tool events and codemode nested calls                                     |
| `tool`                           | Pi tool name, such as `bash`, `write`, or `mcp__server__tool`                               |
| `operation`                      | `read`, `write`, `command`, `mcp`, `network`, or `tool`                                     |
| `command`                        | The bash command text, when present                                                         |
| `paths`                          | Canonical paths, each with `access` (`read` or `write`) and `outsideWorkspace`              |
| `destination`                    | Host for a recognized network command, when known                                           |
| `matchedRule`                    | `source` (`profile`, `user`, `project`, `protected`), `pattern`, and `action`               |
| `reason`                         | Why the call asks, such as `wrapper`, `unparsed`, `outside_workspace`, or `mcp_unannotated` |
| `sessionScope`                   | The pattern an `allow_session` answer grants, such as `touch *`                             |

Pau adds the session ID and session generation itself because it knows which
process sent the request.

### Answer

Pau answers with a normal dialog response:

```json
{
	"type": "extension_ui_response",
	"id": "<pi dialog id>",
	"value": "{\"decision\":\"deny\",\"reason\":\"Use the build script\"}"
}
```

`decision` is `allow_once`, `allow_session`, or `deny`, with an optional
denial reason passed to the agent. A bare option string is also accepted.
`cancelled: true`, an unknown value, or a value that fails validation denies.

### Decision records

After every call it evaluates under a confirming profile, including silent
allows and rule denials, the extension sends a fire-and-forget `setStatus`
with `statusKey` `pau.permission` and a JSON `statusText`:

```json
{ "version": 1, "requestId": "...", "toolCallId": "...", "outcome": "allowed", "source": "rule" }
```

`outcome` is `allowed` or `denied`. `source` is `rule`, `session`, `operator`,
`abort`, `timeout`, or `policy_error`. Pau consumes these records and never
displays them. They feed the tool card state and Pau's redacted audit record.
They do not include the command or paths.

### Cancellation and stale answers

The extension passes `ctx.signal` to the dialog. When the run aborts, Pi
resolves the dialog as cancelled and removes its pending entry, so Pi ignores
any later answer with that ID (`rpc-mode.js`, `pendingExtensionRequests`).
This removes upstream's bug where a late answer reported `user_approved`. Pi
sends nothing to the client when it drops a dialog, so the extension sends an
`abort` decision record and Pau removes the prompt.

Pau also cancels its own queued prompts when it sends `abort`, replaces the
session, or sees the process exit, and rejects any browser answer whose
session generation does not match. Sending `cancelled: true` for an already
dropped dialog is harmless.

### Timeout and failure

The extension sets `timeout` from the policy file. Pi resolves an expired
dialog as `undefined`, which denies, and the extension records `timeout`. The
timeout must exceed Pau's browser reconnection window so Pau, not Pi, decides
when a disconnected client fails closed. A throwing `tool_call` handler blocks
the tool in Pi. Closing stdin ends the process.

Pi prepares tool calls one at a time, even in parallel mode, so dialogs arrive
in order. Codemode scripts can start nested calls concurrently, so the
extension keeps its own FIFO queue per session and shows one dialog at a time.

### `tool_execution_start` before the gate

Pi emits `tool_execution_start` and then runs `prepareToolCall`, which runs
the `tool_call` handlers (`pi-agent-core` `agent-loop.js`). An extension cannot
change that order. Under a confirming profile, Pau shows a started tool as
requested, switches it to waiting when a request with the same `toolCallId`
arrives, and to running or denied when the decision record arrives. A blocked
call ends with an error `tool_execution_end`; Pau labels it denied from the
decision record, not failed.

## Known gaps

| Gap                              | How the Pau extension closes it                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-session policy               | Policy file named by an environment variable, written per session by Pau. No Pi config is read or written.                                                                                                                                  |
| Abort leaves a dialog answerable | Dialogs use `ctx.signal`. Pi drops the pending answer and the extension sends an `abort` record. Pau rejects stale generations.                                                                                                             |
| No structured fields over RPC    | The dialog envelope and decision records replace the forwarder.                                                                                                                                                                             |
| MCP annotations ignored          | The extension reads `pi.getAllTools()` annotations. See below.                                                                                                                                                                              |
| Protected-path list              | Pau's Rust code owns one list, now `HOME_CREDENTIAL_PATHS` and `WORKSPACE_SECRET_PATTERNS` in `crates/core/src/sandbox/policy.rs`, and writes it into the policy file. Sample files such as `.env.example` follow as allows.                |
| `bash -c` and other wrappers     | The vendored analysis floors `bash -c`, `eval`, `sudo`, `env`, `xargs`, and `find -exec` to ask and limits session approvals to the inner command. Pau keeps that floor in both profiles. An empty parse for a non-empty command also asks. |
| Review log copies commands       | There is no review log. Decision records carry no arguments.                                                                                                                                                                                |

For MCP tools, the confirm-mutating profile allows a call when the tool
declares `readOnlyHint: true` and `openWorldHint: false`. The confirm-writes
profile still asks for every MCP tool. Missing hints take the MCP defaults,
which ask. Servers declare these hints and nobody verifies them, so the
permission dialog should say when an allow came from a hint. The
`pi-mcp-adapter` `mcp` proxy tool has no per-tool annotations and always asks.

## Estimated size

| Part                                        |                      Lines |
| ------------------------------------------- | -------------------------: |
| Gate, queue, envelope, and decision records |                        350 |
| Policy schema, loading, and rule matching   |                        400 |
| Session approvals                           |                        150 |
| MCP annotations and tool classification     |                        100 |
| Reload command and lifecycle                |                        100 |
| Pau-owned code                              |                about 1,100 |
| Pau tests, including an RPC fixture run     |                about 1,500 |
| Vendored bash and path analysis             | about 10,500, 41% comments |
| Vendored tests                              |               about 16,000 |

## Maintenance cost

Pau's own code depends on a small Pi surface: `tool_call`, `ctx.ui.select`
with `signal` and `timeout`, `ctx.signal`, `pi.getAllTools()`,
`pi.registerCommand()`, and the session start and shutdown events. Pau's
existing Pi compatibility runs already cover a Pi upgrade.

A vendor sync copies the listed files at a chosen upstream commit, runs the
vendored tests, and needs a review of the upstream diff. It cannot conflict
because Pau never edits vendored files. A local fix goes upstream first. Pau
should sync when upstream fixes a wrapper or exemption bug, and otherwise
before each Pau release.

What Pau gives up:

- Fixes outside the vendored files, such as 40.0.2's session grant leaking to
  other units of a bash chain. Pau's session approval tests should copy
  upstream's cases.
- Subagent forwarding. A child Pi started by `pi-subagents` does not load
  Pau's extension and runs ungated.
- `commandEffects` declarations, the cross-extension service API, skill read
  gating, and hiding denied tools from the system prompt.
- Upstream tracking of new Pi versions. Pau does this tracking for its RPC
  adapter anyway.

If an operator also has the upstream package installed as a Pi resource, both
gates run and either can block. Pau should say so in the profile settings.

## License and attribution

The upstream license is MIT, `Copyright (c) 2026 MasuRii and Christopher D.
Lasher`. Copying the files requires keeping that copyright line and the
permission notice with them. Pau should:

- keep the upstream `LICENSE` unchanged in the vendored directory and in the
  published package files
- record the source URL, commit, release, and copied file list in `SOURCE.md`
- state in the package README that the vendored directory is MIT-licensed and
  the rest is `MIT OR Apache-2.0`
- keep upstream file headers unchanged

`web-tree-sitter` and `tree-sitter-bash` are MIT and stay ordinary
dependencies, so their notices come with their packages.

## Decisions

Pau adopted the recommendation, with Valibot in place of Zod for validation.

- The package stays private for now.
- The first release includes the vendored bash analysis.
- The confirm-writes profile allows MCP tools annotated as read-only and
  closed-world.
- A setting controls sessions that load `pi-subagents`. The default refuses a
  confirming profile, and the alternative passes the extension and policy
  file to child processes.
- Changing a profile restarts Pi on the same session file. The
  `/pau-permissions reload` command remains a documented alternative.

## Upstream behavior under Pi RPC

An earlier spike ran `@gotgenes/pi-permission-system` 40.3.0 under Pi 1.0.0 RPC
with a local scripted model.

- The `tool_call` gate decides before execution for an extension tool, a
  `bash` command, a `write`, a Pi MCP tool (`mcp__<server>__<tool>`), and a
  `curl` request. No marker file or network request existed when the prompt
  appeared. A denial left none afterward, and an approval produced one.
- Protected reads through `read` and through `cat` in `bash` are denied without
  a prompt, and the denial result does not contain the file. Workspace reads
  pass silently. Reads outside the workspace ask.
- Outside TUI mode, the dialog is an RPC `select` titled
  `Permission Required` with `Yes`, a session approval, `No`, and
  `No, provide reason`. The last option sends an `input` request, and its text
  reaches the agent as the denial reason. The session option text names the
  granted pattern, such as `touch *`, so Pau must answer with the exact option
  string. A later matching command in the same process runs without a prompt.
- Cancelling a dialog, answering with an unknown option, closing Pi's stdin,
  and letting `promptTimeoutMs` expire each deny the request. An invalid global
  configuration file asks for everything, including operations the file meant
  to allow. With no configuration, every gated operation asks.
- Two tool calls in one turn produce one dialog at a time, in order.
- Session approvals live only in the Pi process. The package has no durable
  approval storage.

Configuration is read from
`<agent dir>/extensions/pi-permission-system/config.json` and from
`<cwd>/.pi/extensions/pi-permission-system/config.json`. Pi loads the project
file only when the project is trusted, and in RPC mode trust comes from
`--approve`, a saved decision, or `defaultProjectTrust`. Neither file is
scoped to one session. Writing the user file changes every personal Pi
session, and `--approve` also loads the project's other Pi resources. A
project file replaces matching user rules, so a trusted repository can relax a
user's protected-path rule. The package has no API for setting policy from
another extension. A per-session profile without these side effects remains
open upstream in
[issue #799](https://github.com/gotgenes/pi-packages/issues/799).

Review events stay inside the Pi process. `permissions:ui_prompt` and
`permissions:decision` on the extension event bus carry a request ID, surface,
value, matched rule, and resolution, and the review log at
`<agent dir>/extensions/pi-permission-system/logs/` adds the tool call ID. RPC
receives only the dialog text and option labels. To show the session,
operation, and affected paths as structured fields, Pau would need its own
extension.

Known gaps:

- Pi emits `tool_execution_start` before the gate runs, including for denied
  calls. Pau must not present that event as execution or approval.
- Pi does not dismiss a pending dialog when a run is aborted, and the package
  accepts a later answer. The tool still does not run, but the decision event
  reports `user_approved`. Pau must cancel its pending requests on abort and
  reject stale answers itself.
- The package does not read MCP tool annotations, so read-only MCP tools ask
  under both confirming profiles. The `mcp` proxy tool from `pi-mcp-adapter`
  was not exercised. The run used Pi's built-in MCP client.
- The review log records `bash` commands and tool input previews. Pau's audit
  records must not copy them.
- Only Pi 1.0.0 was exercised.
