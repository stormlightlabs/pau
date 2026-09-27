# Backend contracts

## Commands

HTTP handles finite operations such as opening a workspace, starting a session,
reading a file, or changing settings. Commands return after validation and
acceptance; long-running progress arrives as events.

## Events

Every server event has:

```text
sequence, timestamp, workspace_id?, session_id?, kind, payload
```

The event hub keeps a bounded in-memory replay window and persists only events
needed for recovery or indexing. On connection, the frontend requests a state
snapshot and then subscribes after the snapshot's sequence number. Slow clients
are disconnected and recover through replay rather than blocking agent output.

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
sandbox profile unless their execution boundary has been reviewed. Stdio MCP
servers may run as descendants of the tool host; remote MCP and other in-process
tools are unavailable under the profile until an equivalent boundary exists.
This makes the trusted boundary explicit instead of describing path checks in
the Pi process as containment.

The prototype confirms this design with Pi 0.87.1 in RPC mode and Pi's faux
model. The tool host runs each tool's complete `execute` call rather than
replacing Pi's pluggable file operations: Pi's grep tool starts ripgrep in its
own process even when custom operations are supplied. The extension forwards
the session ID, session file, model, and thinking level that built-in tools read
from the extension context. It also routes operator `!` commands to the tool
host, activates only the seven built-in tools, and blocks any other tool call.
When the sandbox cannot start, tool calls fail and nothing runs in the Pi
process.

Under a profile, disable tools from other extensions, including the Claude
bridge's delegation tool and every tool from `pi-mcp-adapter`. That adapter
runs in the Pi process and starts stdio servers there, so its servers need a
launch path inside the tool host before they can stay enabled.

The tool host has its own Pi agent directory in the session's temporary
directory, so it cannot read Pi's settings or credential store and cannot
download tools. That directory holds links to the existing `fd` and a ripgrep
wrapper. Pi's grep tool rejects a search when ripgrep exits with status 2, and
ripgrep does so for any unreadable file, including a read-denied `.env` or a
Bubblewrap placeholder. The wrapper drops permission-denied diagnostics and
keeps every other error. Replace it if Pi accepts partial ripgrep results.

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

`packages/sandbox` holds the prototype launcher, profile translation, tool
host, and fixture runs. On Linux with Bubblewrap 0.12.0, the fixtures confirmed
these guarantees for the workspace-write and read-only profiles:

- Writes succeed only in the workspace, the per-session temporary directory,
  and explicitly granted roots.
- Credential stores under the home directory and workspace `.env` files are
  unreadable, while `.env.example` stays readable.
- Existing and new `.git/hooks` entries, `.git/config`, `.pi`, `.claude`,
  `.codex`, `.mcp.json`, `.vscode`, and `.idea` are read-only.
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
- It denies writes to `~/.npm/_logs` and `~/.claude/debug`, which the runtime
  makes writable by default.

Known gaps to carry into the managed sandbox:

- Reads outside the workspace remain allowed apart from the credential list.
- `/tmp/claude` is bound writable, and shared by every sandbox, whenever it
  exists on the host.
- The wrapped command starts `bwrap` through a `PATH` lookup, so the launcher
  must control `PATH` or pin the executable.
- The runtime sets `NO_PROXY` for loopback. Clients that honor it skip the
  proxy and cannot reach a granted loopback address.
- Only proxy denials are attributed to the command as violation events.
  Filesystem, socket, and direct TCP denials surface only as the child's
  errors.
- Bubblewrap mounts empty, unreadable placeholders for absent protected paths
  such as `.bashrc` and `.gitmodules`. They appear in directory listings and on
  the host while a command runs, and `SandboxManager.reset()` removes them. A
  crash of the launcher process leaves them behind.
- `--new-session` detaches the command from its terminal. A shell on a PTY runs
  with job control off, so an operator terminal profile needs further work
  before it is offered.
- `SandboxManager` holds one policy per process, so each policy needs its own
  launcher process.

Neovim in headless mode keeps the workspace-only write policy, so terminal
editors can use the terminal profile. Graphical editors start servers and helper
processes that Pau does not own and remain unsandboxed.

The macOS Seatbelt profile and a real Ubuntu 24.04 host remain unverified. Do
not claim equal isolation where platform guarantees differ.

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
prevents safe substitution. Use whole-value masking or reviewed structured
formats with a fail-closed no-match policy; do not accept an operator regex that
can silently expose the source. Credential files remain denied in the initial
cross-platform profile because runtime file masking degrades to denial on macOS.
Model and MCP OAuth credentials are never eligible for tool brokerage.

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
Use the selected optional Pi package
[`@gotgenes/pi-permission-system`](https://pi.dev/packages/@gotgenes/pi-permission-system)
instead of building a second policy engine.
The evaluated 34.0.1 release is MIT-licensed, targets current
`@earendil-works` Pi packages, fails closed, canonicalizes protected paths,
gates shell, file, MCP, skill, and extension operations, queues prompts, and
uses Pi's supported `select` and `input` requests outside TUI mode. Pin the
exercised version and recheck its compatibility and security behavior when
updating it.

Pau loads the package only when the operator selects a permission profile or has
already configured it as a normal Pi resource. Pau owns the cross-agent profile
names and maps them to adapter-native policies; it does not fork the package or
reimplement its Pi parser and gate logic. A compatibility spike must verify the
mapping, RPC dialogs, package configuration scope, and review events before the
selection becomes a release dependency.

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
