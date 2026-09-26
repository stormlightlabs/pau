# Agent integrations

## Pi integration

Run one `pi --mode rpc` process per live Pi session. Implement the JSONL
protocol directly in `pau-pi`; this avoids embedding Node solely to reach the
TypeScript SDK. Preserve unknown fields so Pi protocol additions do not crash
the bridge.

The adapter must:

- correlate command responses by ID
- subscribe before prompting and wait for `agent_settled`, not `agent_end`
- assemble deltas for display and replace them with authoritative `message_end`
  values
- keep stderr separate as diagnostics
- support extension UI requests
- expose desktop equivalents for vanilla Pi input history, image input, queues,
  transcript search and copy, shell context, session statistics, export, new,
  switch, fork, clone, rename, compact, retry, model, thinking-level, tool,
  steer, follow-up, and abort operations when advertised
- dispose the process when the owning session stops

Use Pi's native directories and package commands for resource management. Do not
edit session JSONL as an application database.

A TypeScript sidecar remains an option only if a required feature exists in the
SDK but not RPC. If introduced, it should expose the same adapter contract over
framed stdio and remain replaceable.

## Claude bridge plugin

The first deliverable is a new Pi package, built from scratch, that controls
Claude Code through a structured bridge. It must work from Pi before the desktop
application exists and expose the smallest useful lifecycle: detect Claude,
start or resume a session, send work, stream events, interrupt work, and stop
the child process. Claude's native session identifier and transcript remain
authoritative.

Keep process control separate from Pi-facing commands and tools. The bridge
writes versioned framed events, keeps diagnostics off the protocol stream, and
reports capabilities explicitly. Capture protocol fixtures and use a fake Claude
executable for default tests. Live Claude tests remain opt-in.

The desktop adapter later consumes the same bridge contract instead of growing a
second Claude integration. Protocol changes therefore start in the plugin
fixtures and compatibility tests.

Before implementing interrupt support, spike the official TypeScript Agent SDK
against the existing bridge contract. Adopt it internally if it can use the
discovered Claude executable, preserve native session IDs, support streaming,
interrupts, and permission callbacks, and avoid silently selecting a bundled
older binary. Otherwise keep the direct stream-JSON transport and record the
unsupported control boundary. The public bridge contract does not depend on
that choice.

The interrupt spike evaluated `@anthropic-ai/claude-agent-sdk` 0.3.281. Its
`pathToClaudeCodeExecutable`, `resume`, streaming `Query`, `interrupt()`, and
`canUseTool` APIs meet the individual control requirements. The SDK was not
adopted because its `Query` owns and hides the process transport, stderr, and
shutdown sequence. Replacing the current transport would change the exported
`ClaudeProcess` stream and exit contract or create two process owners around
its custom spawn hook. The npm package is also all-rights-reserved under
Anthropic's legal terms and installs bundled CLI packages by default. The
bridge therefore keeps its direct stream-JSON transport, always starts the
executable returned by discovery, and sends Claude's correlated `interrupt`
control request itself.

The Pi package exposes explicit lifecycle and task commands. A model-callable
delegation tool is available only after the operator enables it for the current
Pi session. One Pi session owns one current Claude session. The package records
the native ID in Pi session metadata, but a new Pi process requires an explicit
resume. Claude runs in Pi's working directory.

The package provides these execution profiles:

- `review` uses restricted, non-interactive permissions and cannot edit files or
  run commands.
- `review-with-checks` may run an explicit allowlist of inspection and check
  commands, which can produce local artifacts.
- `work` forwards permission requests through Pi when the selected transport
  supports it. Otherwise it uses Claude's automatic permission mode and denies
  requests that still need an operator response.

Bypass-permissions mode is not part of the normal package interface. Trusted
workspaces use the user's native Claude configuration by default; safe mode is
available when hooks, plugins, MCP servers, memory, and project configuration
must be disabled. The package never handles Claude credentials itself and runs
only the user's unmodified, authenticated Claude executable.

The package inherits Claude's configured model and effort, applies a finite turn
limit, accepts an optional dollar budget, and reports the effective limits and
reported cost. Pi may receive a bounded final result as context; detailed tool
events remain operator-visible unless requested.

Compatibility is feature-based rather than tied to a whole major version. The
initial Claude floor is 2.1.259. Test the floor and latest release, inspect
runtime capabilities, and degrade optional behavior when a capability is absent.
A newer unverified version may run with a warning when the required handshake
succeeds; there is no hard maximum version. Apply this minimum-capability,
latest-release policy to later agent adapters as well.

Pi runs inside tmux or Zellij; the bridge does not create or control panes.
Detaching leaves Pi and its Claude child running. Exiting Pi stops the child,
and a later Pi process can explicitly resume the native session.

## Other agent adapters

Build each adapter from captured protocol fixtures and capability tests. Prefer
documented machine-readable modes. `pau-agent` supplies shared process
discovery, environment construction, cancellation, and logging; `pau-term`
supplies PTY transport. Neither may parse terminal escape output into invented
structured agent events.

Adapter support is graduated:

1. installed binary detection and version reporting
2. interactive PTY session
3. structured prompt and event streaming
4. native resume and session discovery
5. permissions, tools, models, and branching where supported

The UI displays the supported level.

## MCP integration

Use each agent's native MCP client and configuration format when available. Pau
owns discovery, source and scope presentation, file-preserving edits, trust
prompts, diagnostics, and sandbox policy. It does not normalize all agent MCP
configuration into one schema and does not introduce a universal MCP broker.

Pi has no native MCP client or RPC commands. Use
[`pi-mcp-adapter`](https://pi.dev/packages/pi-mcp-adapter) as the selected Pi
package instead of building another MCP client. The evaluated 2.37.0 release
is MIT-licensed, uses the current `@earendil-works` Pi packages, supports stdio,
Streamable HTTP, OAuth, elicitation, resources, prompts, lazy tool discovery,
secure credential storage, public configuration helpers, versioned status
snapshots, and MCP conformance tests. Pin the exercised version for a Pau
release and recheck its license, maintenance state, Pi compatibility, package
contents, and protocol coverage when updating it.

[`pi-mcp-extension`](https://pi.dev/packages/pi-mcp-extension) 1.5.0 was not
selected. It is a smaller MIT-licensed client, but targets the former
`@mariozechner` Pi package names, implements an older
MCP tool-client surface, and has substantially narrower tests and lifecycle,
authentication, configuration, and diagnostics support.

Pau-managed MCP is off by default. Pau never silently loads
`pi-mcp-adapter`, imports another host's configuration, connects a server, or
exposes MCP tools. Existing native agent MCP configuration remains active
because the operator already opted into it. Resource management may offer to
install the package through Pi's package command after showing its source,
version, scope, and executable-code warning.

Store Pau's MCP enablement as a workspace default with a per-session override.
Enable servers individually and retain lazy connection. Apply the active agent
permission policy to MCP tools rather than creating a second approval system.
OAuth remains owned by the native client or adapter credential store; Pau starts
the flow but never reads or stores the token. Pi MCP configuration follows the
adapter's documented shared and Pi-specific sources. Preserve unknown fields and
source precedence rather than rewriting an effective merged document.

Before building the Pi MCP UI, run the selected adapter under Pi RPC and verify
approval, elicitation, OAuth, status, failure, and shutdown behavior. Supported
notifications and dialogs use Pi's extension UI protocol. Do not parse its
terminal-only panels. If Pau needs richer live status than RPC exposes, prefer
an upstream structured RPC surface; add an optional, versioned Pau bridge only
for a demonstrated gap.
