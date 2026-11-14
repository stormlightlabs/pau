# Backend contracts

## Commands

HTTP handles finite operations such as opening a workspace, starting a session,
reading a file, or changing settings. Commands return after validation and
acceptance; long-running progress arrives as events.

## Agent sessions

`POST /api/sessions` names its agent as `pi` or `claude`, and Pi starts when
the request names none. `pau-agent` lists the supported agents. Pi sessions
run through `pau-pi`. Claude sessions run through `pau-agent`'s Claude bridge
client, which starts the `pau-claude-bridge` host for the discovered Claude
Code. Every session reports its agent and the controls it accepts. A route
for a control the agent lacks answers `501 unsupported_control`. An unknown
agent is refused with `400 unknown_agent`. An agent that cannot start is
refused with `503 agent_unavailable` and its discovery reason.

A Claude session resumes a conversation when the request names its Claude
Code session ID. A resumed session reports that ID from the start, and every
session reports the ID of each finished turn. The bridge keeps no message
history, so a client shows a Claude session's transcript from the events it
received.

## Agent readiness

`GET /api/agents/readiness` reports, for each supported agent, whether Pau
found the executable, its version, whether that version is supported, and a
reason when the agent cannot start a session. For Pi it also starts a
short-lived `pi --mode rpc` to count the models Pi reports; that check is
limited to 10 seconds and creates no session. Claude is ready when Claude
Code runs a supported version, with `claude --version` limited to 5 seconds,
and `pau-claude-bridge` is installed. Discovery uses the backend's `PATH` as
it is. The report is read-only, reused for 30 seconds, and `?refresh=true`
runs the checks again.

## Agent resources

`GET /api/workspaces/{workspace_id}/resources` lists the skills, prompts,
extensions, themes, and packages Pi finds for the workspace, without starting
Pi. Each entry names its kind, scope, source, trust, and status. Status is
ready, duplicate with the path of the resource that loads instead, invalid,
or missing for a declared package that is not installed. Each entry carries
the warnings about its own file. Problems that belong to no entry, such as an
unreadable settings file or a listed path that does not exist, stay in the
index's warnings, so one bad file never hides the rest.

User resources are trusted. Project resources follow Pi's saved project trust
decision in `trust.json`, or `defaultProjectTrust` when none applies. A
`project_trust` extension or Pi's `--approve` flag can still decide
differently inside a running Pi, and the index cannot see either.

Until the project is trusted, Pi reads neither its resources nor its
settings, so project entries never win a collision with user entries, and a
project package entry never replaces the user entry for the same package.
Collisions among project entries still resolve as they would once trusted.

## Events

Every server event has:

```text
sequence, timestamp, workspace_id?, session_id?, kind, payload
```

The event hub keeps a bounded in-memory replay window and persists only events
needed for recovery or indexing. On connection, the frontend requests a state
snapshot and then subscribes after the snapshot's sequence number. Slow clients
are disconnected and recover through replay rather than blocking agent output.
Native agent output is transient: replay delivers it, but snapshots hold only
the latest state-bearing event for each workspace, session, and kind.

A client showing a workspace's files connects with `?watch=<workspace_id>`.
The server watches that workspace while at least one such connection is open
and stops when the last one closes. Each connection starts from a snapshot,
and the client reloads what it shows on every connection. Changes arrive as
transient `workspace_files_changed` events with the changed paths, a flag for
Git branch, index, or ref changes, and a `truncated` flag when one burst
changes more than 500 paths. The watcher drops ignored paths, credential files,
and Git's internal files other than `HEAD`, the index, and refs.

Do not force native events into one large enum too early. Use a small stable
envelope plus adapter-owned typed payloads. Promote fields into common events
only when at least two adapters use the same semantics.

## Process ownership

Rust owns every child process, stdin/stdout task, cancellation token, and exit
watcher. A registry maps stable session IDs to live process handles. Child
shutdown is staged: protocol shutdown, interrupt, terminate, then kill after a
timeout.

PTY processes use a cross-platform Rust PTY library. Structured protocols use
pipes, never a PTY, so framing and diagnostics stay separate.

A PTY terminal keeps reading output while no view is attached. It retains the
last 1 MiB, dropping the oldest bytes first, and replays it to each view that
attaches before sending live output. Once output has been dropped, the replay
starts with sequences that restore the terminal modes the dropped output set,
such as the alternate screen, mouse tracking and bracketed paste. The terminal
list is in opening order, so a client that mounts its terminal view again,
after a route change for example, reattaches its tabs in that order.

Terminal output never waits for a view, and the memory it holds is fixed. Up
to 512 KiB waits between the PTY reader and the scrollback. When that buffer
fills, the reader stops and the child blocks on its next write. Live output to
views shares one buffer of 256 chunks of at most 8 KiB. A view that falls
further behind is closed with code 1013, and the client reconnects with a
delay that starts at 250 ms and doubles up to 8 s, then catches up from the
scrollback.

## Resource monitoring

Every process owner reports the operating-system process identifier, process
start time, stable Pau process identifier, workspace, session, and parent to a
shared monitor. PID and start time form the sampling identity so PID reuse does
not attach an old history to a new process. Descendant use is attributed to the
owning session while the process breakdown remains available for diagnosis.

Sample active process trees every two seconds. Keep approximately 30 minutes of
raw samples in a bounded in-memory ring and send throttled, non-durable snapshots
to connected clients. Do not put every sample in the sequenced recovery event
log. Persist only final summaries such as peak resident memory, CPU time,
elapsed time, I/O totals when reliable, process count, and termination details.

CPU, resident memory, and descendant discovery are required on Linux and macOS.
Disk I/O is best effort and must be labelled when a platform cannot report it
reliably. GPU and per-process network accounting are outside the first
implementation. Resource warnings are advisory and require sustained pressure;
they may offer interrupt or stop, but do not automatically kill or throttle a
session. Token, context-window, and cost values come from native agent protocols
and remain separate from operating-system measurements.

## Diagnostics

Diagnostics are available in release builds through an explicit settings control
and CLI flag. Enabling diagnostics adds observation only. It must not change
supervision, retry timing, permissions, sandboxing, authentication, or process
limits. Fault injection, fake events, forced disconnects, and child-process
failure controls compile or ship only in development builds.

Each subsystem writes structured diagnostic records to bounded in-memory rings.
Records include component, severity, timestamp, stable process or session IDs,
operation, duration, transport state, queue pressure, and error classification.
Keep stderr and protocol traffic separate. A small metadata trace records
adapter handshakes, capabilities, WebSocket reconnects, event sequence and replay
gaps, process starts and exits, slow consumers, and dropped updates without
capturing content payloads.

Payload-level protocol tracing is off by default and requires temporary explicit
enablement. Apply redaction before a record enters a trace, UI event, log, or
export buffer. Do not record credentials, environment values, prompts, file
contents, tool arguments, transcript content, paths outside the workspace, or
sensitive URL components. A subsystem that cannot prove redaction omits the
field instead of exporting it.

A user-initiated diagnostic export contains build and dependency versions,
adapter capabilities and handshake results, process summaries, transport state,
configuration shape without values, and recent redacted records. Routine traces
remain non-durable. The export path is the only persistence path for a diagnostic
bundle, and the UI shows its contents and destination before writing it.

## Local process sandbox

Follow the two-layer pattern used by
[Claude Code](https://code.claude.com/docs/en/sandboxing) and
[Codex](https://learn.chatgpt.com/codex/agent-approvals-security): permission
policy decides when to ask, while operating-system containment limits what an
approved process can do. Launch unsandboxed by default. Store the selected
sandbox as a workspace default with a per-session override.

When enabled, the initial profile permits writes to the workspace and a
dedicated temporary directory, keeps required system and runtime files
read-only, protects repository and agent configuration from self-modification,
blocks sensitive files and environment variables, and starts with network
access disabled. Broader paths, domains, local addresses, and Unix sockets
require explicit grants. Never retry outside the sandbox silently.

Prefer an adapter's native command sandbox when it provides the required
filesystem, network, credential, descendant, and failure guarantees. Pau's Pi
integration keeps the RPC agent host outside containment so it can use its
native model credential store and provider network. An explicitly loaded
first-party extension replaces every enabled built-in file, search, and command
tool with calls to a separate Pau tool host. That host runs inside one OS
sandbox and executes the operations and subprocesses; it never receives
Pi's model credentials. Tools from other extensions are disabled under a
sandbox profile unless their execution boundary has been reviewed. This makes
the trusted boundary explicit instead of describing path checks in the Pi
process as containment.

`pau-core::sandbox` owns the policy. It validates a selection, canonicalizes
roots, pins the containment executables, and resolves a launch into the
sandbox-runtime configuration, the tool environment, the predicted placeholders,
and the effective profile the operator sees. It writes the result to a policy
file in a host-private session directory that the sandbox cannot read.
`packages/sandbox` only consumes that file, so the profile shown before launch
is the one that runs. Its fixtures obtain policies from the same code through
the `sandbox-policy` binary.

The prototype confirms this design with Pi 0.87.1 in RPC mode and Pi's faux
model. The tool host runs each tool's complete `execute` call rather than
replacing Pi's pluggable file operations: Pi's grep tool starts ripgrep in its
own process even when custom operations are supplied. The extension forwards
the session ID, session file, model, and thinking level that built-in tools read
from the extension context. It also routes operator `!` commands to the tool
host, activates only the seven built-in tools, and blocks any other tool call.
When the sandbox cannot start, tool calls fail and nothing runs in the Pi
process.

Tools from other extensions need their own contained launch path.
`pi-mcp-adapter` runs in the Pi process, so Pau starts a sandboxed Pi with a
session MCP configuration through `--mcp-config` and the adapter's exclusive
mode, which loads no other source. Each enabled stdio server becomes an entry
for the adapter's Unix socket transport. The extension serves that socket
outside the sandbox and starts the server as a descendant of the tool host, so
the server gets the same policy as every tool. A remote server is included only
when its host is a granted domain. The adapter has no proxy setting, so remote
MCP traffic leaves from the Pi process rather than through the sandbox proxy;
the effective profile lists this gap. Other servers are disabled. The Claude
bridge starts Claude with its own sandbox, described below. A tool without a
contained path is disabled under a profile by default. The operator may enable
it for one tool, after which each call asks for approval and states that the
call runs outside the sandbox.

The tool host has its own Pi agent directory in the session's temporary
directory, so it cannot read Pi's settings or credential store and cannot
download tools. That directory holds links to the existing `fd` and a ripgrep
wrapper. Pi's grep tool rejects a search when ripgrep exits with status 2, and
ripgrep does so for any unreadable file, including a read-denied `.env` or a
Bubblewrap placeholder. The wrapper treats permission-denied diagnostics as
skipped files and keeps every other error. It passes the skipped paths to the
tool host, which adds them to the grep result so the model and operator know
the search was incomplete. Placeholders are omitted from that list because they
are not real files.

### Sandbox runtime selection

Use `@anthropic-ai/sandbox-runtime` 0.0.77 from
[anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime). It
is Apache-2.0 licensed and is released every one to two weeks; 0.0.77 shipped
on 2026-09-18. It is a beta research preview, so pin the exercised release,
review source and release changes before updating, and do not build Pau policy
around undocumented behavior. On Linux it runs commands under Bubblewrap with
new user, PID, and network namespaces, a seccomp filter that blocks Unix
sockets, and host-side HTTP and SOCKS proxies reached through `socat`. On macOS
it uses Seatbelt profiles. Bubblewrap (LGPL-2.0-or-later), `socat`
(GPL-2.0), and ripgrep (MIT or Unlicense) are required Linux executables,
not linked libraries.

`packages/sandbox` holds the launcher, the Pi extension and tool host, the MCP
relay, and the fixture runs. On Linux with Bubblewrap 0.12.0, the fixtures
confirmed these guarantees for the workspace-write and read-only profiles:

- Writes succeed only in the workspace, the per-session temporary directory,
  and explicitly granted roots.
- Credential stores under the home directory and workspace `.env` files are
  unreadable, while `.env.example` stays readable.
- Existing and new `.git/hooks` entries, `.git/config`, `.pi`, `.claude`,
  `.codex`, `.mcp.json`, `.vscode`, `.idea`, and `.zed` are read-only.
- Reads and writes through host-created and sandbox-created symlinks follow
  the target's policy.
- Network access is off by default, including direct TCP that bypasses the
  proxy. Granted names that resolve to this host's addresses are refused.
- Host Unix sockets are blocked unless every socket is granted, because Linux
  cannot filter them by path.
- Children, grandchildren, and detached descendants inherit the policy and stop
  when the command exits or its launcher is killed.
- Provider keys in Pau's environment do not reach the sandbox.

Pau's launcher adds the checks the runtime does not make:

- It builds the whole child environment. sandbox-runtime forwards every
  variable the caller passes and adds only proxy settings.
- It runs a no-op sandboxed command before first use. The runtime's dependency
  check reports a missing `bwrap` or `socat`, but it passes when Ubuntu 24.04's
  AppArmor user-namespace restriction makes every command fail at run time.
- It never gives a sandboxed shell a socket on standard input. Node connects
  piped streams with Unix sockets, and bash then behaves like a remote-shell
  login: NixOS sources the system bashrc and resets `PATH`, while Debian
  sources the user's `~/.bashrc`. Structured channels use file descriptor 3.
- It restores the session's `TMPDIR`. The runtime replaces it with a shared
  `/tmp/claude` directory.
- It disables core dumps, which could write process memory into the workspace.
- It denies writes to `~/.npm/_logs` and `~/.claude/debug`, which the runtime
  makes writable by default.

Sandbox profiles allow reads outside the workspace apart from the credential
list, as Claude Code and Codex do. Permission profiles gate outside reads by
Pi's `read`, `grep`, `find`, and `ls` tools, but not reads made inside `bash`.
An optional home read-deny setting denies the home directory and re-allows the
workspace and required toolchain directories. Pau recommends it when a profile
grants network access, because that is when an unlisted file can leave the
machine.

sandbox-runtime binds `/tmp/claude` writable, and shared by every sandbox,
whenever it exists on the host. Pau's tools use the session temporary directory,
and the runtime's Linux proxy sockets live directly in `/tmp`, so Pau denies
writes to `/tmp/claude` by default. An operator who shares the directory with
Claude Code on purpose can allow it with the profile's shared-temp option.

sandbox-runtime otherwise starts `bwrap`, `socat`, and ripgrep through a `PATH`
lookup for each command. Release 0.0.77 honors explicit `bwrapPath`,
`socatPath`, and `ripgrep.command` settings, so Pau resolves the three
executables once at startup, requires Bubblewrap 0.11 or later, and writes their
absolute paths into every policy. A directory added to `PATH` later cannot
replace them. The effective profile shows the resolved paths and version.

The runtime puts loopback and private ranges in `NO_PROXY`. On Linux the
sandbox has no network interfaces, so clients that honor `NO_PROXY` bypass the
proxy and cannot reach a granted local address. The policy therefore always
sets `NO_PROXY` explicitly and removes each entry that covers a granted loopback
or private address. A network change sends the new value to the running tool
host, which passes it to commands it starts afterward. Report the behavior
upstream and drop the override when the runtime handles it. Confirm on macOS
whether the override is needed there.

sandbox-runtime attributes only proxy denials to a command on Linux.
Filesystem, socket, and direct TCP denials reach Pau only as the child's
errors. Pau owns its denial reporting and does not wait for upstream support:

- The Pi extension compares the paths a failed tool call names with the
  effective policy and adds the denied ones to the error the model receives.
  The sandboxed tool host cannot read the policy file, so the comparison runs
  on the host side. The note names only the operation, the denied path, and
  the rule that blocked it.
- A Rust preload library, loaded into sandboxed processes on Linux, reports
  file and connect calls that fail with `EACCES`, `EROFS`, or `EPERM` to the
  tool host with the operation and path. It also reports `ENETUNREACH` from a
  direct TCP connection in Linux's empty network namespace. Reports use a
  versioned per-session file capped at 1 MiB and remain separate from command
  output. The kernel still enforces the policy; the library only reports.
  Statically linked programs bypass it, and a bypass loses the report, never
  the restriction.
- On macOS, Pau reads Seatbelt denials from unified logging with the
  attribution key that sandbox-runtime adds to each command. The report keeps
  the process name and PID from Seatbelt, including for descendants. Fixture
  runs cover denied file access and direct TCP from a sandboxed process and
  its descendants.
- A failure that reports a refused access but names no denied path is
  labelled as a sandboxed failure, and the model receives the same note.

Bubblewrap can deny an absent protected path only by mounting over a
placeholder, so the runtime creates empty, unreadable files and directories such
as `.mcp.json`, `.claude`, and `.bashrc` in the workspace and removes them in
`SandboxManager.reset()`. Denying creation keeps a sandboxed command from
planting configuration that a later unsandboxed agent would load. The runtime
applies its own list of dangerous files to the current directory of the process
that wraps commands, which is the workspace for Pi. Pau predicts the
placeholders from both lists before launch, the boundary fixtures compare the
prediction with a real launch, and the Pi registry records them with the
process metadata. File, search, and Git views hide recorded placeholders of a
running process while they are still empty. Stopping a session removes any the
runtime left, and the next sandboxed launch removes empty leftovers from a
crash, except paths a live session still records. Pi runs its built-in tools
with the placeholders present. Test Claude Code and a common editor with them
present and list any conflict in the effective profile.

`SandboxManager` holds one policy and one proxy pair per process, so each
sandboxed session has its own launcher. Pi sessions use the extension inside
their RPC process. Rust-owned launches, such as sandboxed terminals, start the
runtime's `srt` command with a generated policy file. Network grants apply to a
running session. Filesystem rules are fixed when the tool host starts, so a
filesystem grant waits for the current tool call, restarts the tool host, and
tells the operator.

sandbox-runtime starts Bubblewrap with `--new-session`, which detaches the
command from its controlling terminal so it cannot inject keystrokes into the
operator's shell. A shell on Pau's PTY therefore runs without job control, and
terminal interrupts and resizes may not reach it. A sandboxed terminal instead
starts a `pau-term` relay inside the sandbox. The relay opens its own PTY, runs
the shell on it, forwards bytes to Pau's PTY, and applies window sizes received
over a control channel. Injected keystrokes then reach only the inner PTY. The
sandboxed terminal profile stays hidden until the relay exists.

Neovim in headless mode keeps the workspace-only write policy, so terminal
editors can use the terminal profile. Graphical editors start servers and helper
processes that Pau does not own and remain unsandboxed.

The complete macOS Seatbelt profile and a real Ubuntu 24.04 host remain
unverified. macOS denial reporting is verified, but do not claim equal
isolation where platform guarantees differ.

Claude runs as its own sandbox host. For a sandboxed Claude session, Pau writes
a Claude settings file with the same filesystem and network policy, requires
the sandbox to start, disables Claude's unsandboxed retry, and uses a strict
domain allowlist. The bridge passes it with `--settings` and adds
`--strict-mcp-config`, because Claude starts MCP servers outside its sandbox.
`WebFetch` and `WebSearch` are denied unless the operator enables them outside
the sandbox, which makes them ask on every call. Claude's sandbox covers Bash
and its descendants; its file tools follow Claude's permission rules, and the
effective profile names that gap.

The sandbox launcher builds a minimal environment rather than forwarding Pau's
environment. Credential brokerage is part of the first release but remains
opt-in per credential. Its initial source is a named variable in Pau's host
environment; persist the variable name and destinations, never its value. Pass
the real value only to the dedicated trusted broker process, not the Pi host or
tool host. The broker places a per-session sentinel in the tool environment.
Its TLS-terminating proxy substitutes that sentinel in headers or request bodies
only for the credential's explicit destination set. Require verified upstream
TLS, keep plaintext injection disabled, and fail closed when certificate
pinning, mTLS, an unsupported protocol, or an unrecognized credential shape
prevents safe substitution. The reviewed environment shapes are a whole value,
a password in `scheme://user:password@host` syntax, and everything after the
first colon in a `name:credential` pair. Reject a structured value that does not
match its selected shape. Do not accept an operator regex that can silently
expose the source. Credential files remain denied in the initial cross-platform
profile because runtime file masking degrades to denial on macOS. Model and MCP
OAuth credentials are never eligible for tool brokerage.

Whole-value `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` references use
sandbox-runtime 0.0.77's reviewed AWS Signature Version 4 re-signing path. An
optional whole-value `AWS_SESSION_TOKEN` joins the pair. Header-signed SigV4
requests are re-signed only for the access key's destination set. Keep the
runtime's fail-closed defaults for streaming signatures, presigned URLs, and
SigV4a.

This broker limits ambient disclosure; it does not make a credential harmless.
A tool authorized for a destination can exercise that credential at the
destination, and a permitted service can reflect a value in its response.
Permission prompts and narrow host grants therefore remain useful. Keep real
values and sensitive URL components out of process arguments, diagnostics,
violation events, and persisted logs. Clear in-memory mappings, generated trust
material, and sentinels when the session ends.

Operator-controlled terminals and editors launched by Pau remain unsandboxed by
default. A terminal editor can use the terminal's explicitly selected sandbox
profile. Other editor launch adapters expose sandbox selection only after their
process and descendant behavior has been verified. The effective profile shown
before launch names readable and writable roots, network and local-socket access,
brokered and
denied credentials, process limits, unsandboxed fallback policy, disabled tools,
and known gaps. Agent permission modes remain guardrails even when they add
useful restrictions of their own.

## Permissions

Permission enforcement belongs to each agent adapter because only the native
agent or an in-process hook can stop a tool before execution. Expose a capability
for pre-execution approval and omit or disable permission controls when the
adapter cannot enforce the decision. Claude, Codex, and Antigravity use native
permission callbacks where their protocols provide them.

Permission prompting is off by default. The first profiles are no prompts,
confirm writes and commands, and confirm mutating or open-network operations.
Workspace reads are allowed except for protected paths; reads outside the
workspace ask. High-confidence credential and authentication paths are denied by
default, with `.env.example`-style samples excluded. A user rule may relax a
protected path, while project policy may only narrow access. Do not imply that
this list detects every secret.

Pi RPC reports tool execution but does not provide a pre-tool approval command.
Pau ships its own private Pi permission extension,
`@stormlightlabs/pau-pi-permissions` in `packages/pi-permissions`.
[Permission extension research](../pems-research.md) records the evaluation
of `@gotgenes/pi-permission-system` 40.3.0 that led to this design.

The extension owns the gate, policy evaluation, dialogs, session approvals, and
RPC messages. It vendors upstream's bash and path analysis unmodified, keeps
upstream's MIT license with a `SOURCE.md` that records the source commit and
copied files, and re-copies those files when upstream fixes land. Bash analysis
ships in the first release because the confirm-mutating profile and protected
reads through `bash` depend on it. Valibot validates the policy file and RPC
payloads. The vendored code's Zod type imports are replaced with local types
instead of adding Zod.

Loading and policy:

- Pau loads the extension with `--extension` only in sessions that use a
  confirming profile, before the sandbox extension. A session without one
  behaves like vanilla Pi.
- Pau merges user and project rules in Rust, so project policy can only narrow
  access, and writes the result to a `0600` file named by
  `PAU_PERMISSION_POLICY_FILE`. The extension never reads Pi's own
  configuration, so Pau does not change the operator's personal Pi setup or need
  `--approve`.
- Rust owns the protected-path list and writes it into the policy file.
- A missing or invalid policy file blocks every gated call.
- Changing the profile restarts Pi on the same session file. A
  `/pau-permissions reload` extension command sent through the RPC `prompt`
  command could apply a change without a restart. Pi runs extension commands
  immediately and the model cannot send them. This option is not planned for
  the first release.
- A setting controls sessions that load `pi-subagents`. By default, Pau refuses
  a confirming profile in such a session and explains that child Pi processes
  would run without permission checks. The alternative passes the extension and
  policy file to each child process.

Profiles:

- No prompts: Pau does not load the extension. Protected paths are denied only
  when a sandbox is selected.
- Confirm writes and commands: allow `read`, `grep`, `find`, `ls`, and MCP
  tools annotated as read-only and closed-world. Ask for every other tool,
  every `bash` command, every other MCP tool, and outside-workspace access.
- Confirm mutating or open-network operations: the previous profile, plus
  read-only `bash` commands identified by the vendored analysis. Network
  commands, wrappers such as `bash -c`, and unknown or unparsable commands
  still ask.

Pi 1.0.0 gives an extension no structured stdout record and no dialog metadata,
so the extension uses dialogs and status records:

- A request is a `select` dialog whose title is a versioned JSON envelope with
  the request ID, tool call IDs, tool, operation, command, paths with their
  access and outside-workspace flag, destination, matched rule, reason, and
  session scope. Its options are `allow_once`, `allow_session`, and `deny`. Pau
  adds the session ID and generation.
- The answer is a dialog value holding JSON `{decision, reason?}`. A cancelled,
  unknown, or invalid answer denies.
- After each evaluated call, a `setStatus` record under `pau.permission`
  reports the outcome and its source without arguments. Pau's audit records use
  it.
- Dialogs use the run's abort signal, so Pi drops a pending dialog on abort and
  ignores a late answer. The extension reports the abort, and Pau cancels its
  queue on abort, session replacement, or exit and rejects answers from a stale
  session generation.
- The policy file sets the dialog timeout, which must exceed Pau's reconnection
  window. Expiry denies.
- Pi emits `tool_execution_start` before the gate runs, including for denied
  calls. Pau shows the tool as requested until the matching request or decision
  record arrives and never presents that event as execution or approval.

A denial stops the operation. An approval permits the agent to attempt it inside
the selected sandbox, whose operating-system restrictions still win. MCP tools
use the same permission policy through their native client or Pi adapter
approval hooks. Direct terminal input is operator initiated and bypasses agent
approval prompts.

Offer deny, allow once, and allow for this session. Do not persist generated
approval rules across sessions in the first release. Queue requests FIFO within
each session, show pending requests from all sessions without a global blocking
modal, and correlate every response by request ID, session ID, and session
generation. Abort and session replacement cancel affected requests; stale
responses are rejected. A disconnected client gets a bounded reconnection
window, after which unanswered requests fail closed.

Persist only redacted decision metadata needed for audit. Never persist tool
arguments merely because they appeared in a permission request.
