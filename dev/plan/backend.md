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

Use the pinned Apache-2.0
[`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime)
as the first dependency to validate. Release 0.0.77 uses Bubblewrap, network
namespaces, and seccomp on Linux and Seatbelt profiles on macOS. It also provides
a host-side HTTP and SOCKS proxy, resolved-address checks, local-socket controls,
violation reporting, and fail-closed dependency checks. It is a beta research
preview, so pin the exercised release, review source and release changes before
updating, and do not build Pau policy around undocumented behavior. The spike
must test its documented Linux dependencies and Ubuntu user-namespace limits,
macOS guarantees, symlink handling, descendant inheritance, cleanup, and
failure modes. Do not claim equal isolation where platform guarantees differ.

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

Operator-controlled terminals and Neovim remain unsandboxed by default; each can
request a separate sandbox profile. The effective profile shown before launch
names readable and writable roots, network and local-socket access, brokered and
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
