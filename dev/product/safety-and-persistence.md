# Safety and persistence

## Safety requirements

- Canonicalize file paths in Rust and reject paths outside configured
  workspace roots.
- Never expose agent credentials, environment variables or auth files through
  general file endpoints.
- Use an unguessable per-launch token for the local desktop API.
- Require authentication for WebSocket upgrades as well as HTTP requests.
- Keep authentication and origin checks active through SSH tunnels, Tailscale,
  reverse proxies and other network paths the operator provides.
- Keep destructive process, worktree, package and file operations explicit.
- Keep sandboxing off by default. Store a workspace default with a per-session
  override, and show the effective filesystem, network, credential and process
  policy before launch.
- When sandboxing is on, start with workspace-write access, a dedicated
  writable temporary directory, protected agent and repository configuration,
  blocked sensitive credentials and network access off. Require explicit paths
  and destinations for broader access, and never fall back to unsandboxed
  execution silently.
- Keep the agent host and its model credentials outside the command sandbox.
  Run supported model-initiated file, search and command tools in a separate
  sandboxed tool host whose descendants inherit the same restrictions. While a
  sandbox profile is active, disable tools that have no proven execution
  boundary.
- Contain supported model-initiated tools and their descendants, including
  stdio MCP servers. Operator terminals and editors that Pau launches stay
  unsandboxed by default. They need a separate explicit sandbox selection where
  that launch path supports containment.
- Offer opt-in credential brokerage for sandboxed tools. The tool gets a
  per-session placeholder instead of the credential, and Pau substitutes the
  real value only on encrypted requests to explicitly configured destinations.
  Never broker model provider credentials, inject credentials over plaintext,
  or expose real values in process arguments, UI events, diagnostics or logs.
  Deny the credential when the source, destination, proxy or substitution
  cannot be verified.
- Label unsandboxed permission controls as guardrails, not sandboxing.
- Record process exit status and adapter errors without mixing diagnostic
  output into protocol streams.
- Redact diagnostics before they enter UI events, in-memory traces, exported
  bundles or logs. Protocol payload tracing needs temporary explicit enablement
  and still excludes credentials and environment values.
- Keep behavior-changing diagnostic controls out of release builds. Turning on
  release diagnostics must not weaken authentication, permissions, sandboxing,
  redaction, retry policy or process limits.

## Persistence

SQLite stores workspace registrations, UI preferences, process metadata,
resource summaries of completed processes, event sequence checkpoints and
resource indexes. Raw resource samples and routine diagnostic logs and traces
stay in bounded memory. A diagnostic bundle is written to disk only when the
operator exports it.

`tokio-rusqlite` provides the initial asynchronous access layer through one
serialized connection. Pooling needs measured contention first.

Native Pi and third-party session files stay authoritative. The database may
cache transcript projections for search, but deleting the cache must not delete
agent history.
