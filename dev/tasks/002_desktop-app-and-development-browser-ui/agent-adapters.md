# 2. Desktop app: Agent adapters

## Agent adapters

### 2.47 Codex sessions

Status: planned
Blocked by: none

Add Codex discovery, structured transport, and capabilities through
`pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, failure, and cleanup against
  a fake Codex executable.
- Keep live Codex tests opt-in.

### 2.123 Codex in the desktop

Status: planned
Blocked by: 2.47

Let the operator start Codex sessions from the desktop app, with controls gated
by Codex's reported capabilities.

Verification:

- Component-test Codex capability states and a missing executable.
- Start and interrupt a session against the fake Codex executable.

### 2.124 Codex resume

Status: planned
Blocked by: 2.47

Resume native Codex sessions through `pau-agent`.

Verification:

- Resume a session against the fake Codex executable and cover a missing
  session.

### 2.125 Codex MCP configuration

Status: planned
Blocked by: 2.47

Map Codex's native MCP configuration and lifecycle into the existing MCP
adapter capabilities and shared MCP UI.

Verification:

- Round-trip Codex MCP configuration and exercise one fixture server through the
  shared MCP UI without changing unknown native fields.

### 2.48 Antigravity sessions

Status: planned
Blocked by: none

Add Antigravity discovery, structured transport, and capabilities through
`pau-agent`.

Verification:

- Run discovery, start, prompt, stream, interrupt, failure, and cleanup against
  a fake Antigravity executable.
- Keep live Antigravity tests opt-in.

### 2.126 Antigravity in the desktop

Status: planned
Blocked by: 2.48

Let the operator start Antigravity sessions from the desktop app, with controls
gated by Antigravity's reported capabilities.

Verification:

- Component-test Antigravity capability states and a missing executable.
- Start and interrupt a session against the fake Antigravity executable.

### 2.127 Antigravity resume

Status: planned
Blocked by: 2.48

Resume native Antigravity sessions through `pau-agent`.

Verification:

- Resume a session against the fake Antigravity executable and cover a missing
  session.

### 2.128 Antigravity MCP configuration

Status: planned
Blocked by: 2.48

Map Antigravity's native MCP configuration and lifecycle into the existing MCP
adapter capabilities and shared MCP UI.

Verification:

- Round-trip Antigravity MCP configuration and exercise one fixture server
  through the shared MCP UI without changing unknown native fields.
