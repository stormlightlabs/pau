# Safety and persistence

## Safety requirements

- Canonicalize file paths in Rust and reject paths outside configured workspace
  roots.
- Never expose agent credentials, environment variables, or auth files through
  general file endpoints.
- Use an unguessable per-launch token for the local desktop API.
- Require authentication for WebSocket upgrades as well as HTTP requests.
- Keep destructive process, worktree, package, and file operations explicit.
- Keep sandboxing off by default. Store a workspace default with a per-session
  override and show the effective filesystem, network, credential, and process
  policy before launch.
- When enabled, start with workspace-write access, a dedicated writable temporary
  directory, protected agent and repository configuration, blocked sensitive
  credentials, and network access off. Require explicit paths and destinations
  for broader access and never fall back to unsandboxed execution silently.
- Keep the agent host and its model credentials outside the command sandbox. Run
  supported model-initiated file, search, and command tools in a separate
  sandboxed tool host whose descendants inherit the same restrictions. Disable
  tools without a proven execution boundary while a sandbox profile is active.
- Apply containment to supported model-initiated tools and their descendants,
  including stdio MCP servers. Operator terminals and Neovim remain unsandboxed
  by default and require a separate explicit sandbox selection.
- Include opt-in credential brokerage for sandboxed tools. Give a tool a
  per-session placeholder instead of the credential and replace it only on
  encrypted requests to explicitly configured destinations. Never broker model
  provider credentials, inject credentials over plaintext, or expose real values
  in process arguments, UI events, diagnostics, or logs. Deny the credential
  when the source, destination, proxy, or substitution cannot be verified.
- Label unsandboxed permission controls as guardrails rather than sandboxing.
- Record process exit status and adapter errors without mixing diagnostic output
  into protocol streams.

## Persistence

SQLite stores workspace registrations, UI preferences, process metadata,
completed-process resource summaries, event sequence checkpoints, and resource
indexes. Raw resource samples remain in bounded memory. `tokio-rusqlite`
provides the initial asynchronous access layer through one serialized
connection; pooling requires measured contention. Native Pi and third-party
session files remain authoritative. The database may cache transcript
projections for search, but deleting the cache must not delete agent history.
