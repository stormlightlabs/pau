# 3. Web server

The third deliverable exposes the shared backend through a separately composed
web application for local or remote browser use. It reuses protocol and feature
packages without importing the desktop route tree or native capability layer.

## 3.1 Standalone serve command

Status: planned
Blocked by: 2

Add a `pau serve` command that serves `apps/web` and the API without Tauri,
binds to loopback by default, and prints a tokenized URL once. Support use on the
server host or through an operator-provided SSH tunnel or private tailnet.

Verification:

- Start from a packaged binary with no frontend development server.
- Load the UI, connect its WebSocket, and reject a request without the token.

## 3.2 Standalone server process lifecycle

Status: planned
Blocked by: 3.1

Apply the desktop process-ownership and recovery contracts to the standalone
server lifecycle. Keep agents and terminals alive when every remote browser
disconnects, and stop or recover them according to explicit server shutdown and
restart behavior.

Verification:

- Disconnect all browsers while each process type is active and reconnect.
- Send server termination signals during active work and confirm bounded cleanup.
- Restart the standalone server after a forced kill and report which native
  sessions can resume.

## 3.3 Server-mode browser suite

Status: planned
Blocked by: 3.1, 3.2

Run the existing `apps/web` integration and Playwright suites against the
packaged standalone server rather than a test-only transport.

Verification:

- Complete workspace, Pi session, Claude session, file, CodeMirror, terminal,
  external editor, resource, and theme flows against fake adapters in CI.

## 3.4 Non-loopback safety gate

Status: planned
Blocked by: 3.1

Require an explicit flag and durable authentication configuration before binding
to a non-loopback address. Enforce origin checks and secure cookie or
bearer-token handling. Keep these checks active on private tailnets and document
the difference between loopback port forwarding and direct tailnet binding.

Verification:

- Refuse unsafe non-loopback startup combinations.
- Test allowed and denied origins, expired credentials, logout, and WebSocket
  authentication.

## 3.5 Remote session and audit controls

Status: planned
Blocked by: 3.4

Add remote session expiry, credential rotation, and rate limits for
authentication attempts. Extend the shared mutation audit with remote identity,
authentication, and session-lifecycle events.

Verification:

- Test idle and absolute expiry, key rotation with existing sessions, rate-limit
  recovery, and redaction of command secrets from audit output.

## 3.6 Remote access and reverse-proxy deployment guide

Status: planned
Blocked by: 3.4, 3.5

Document loopback SSH port forwarding, Tailscale access, TLS termination,
WebSocket forwarding, trusted proxy settings, data directories, backups, and the
server account's command-execution privileges. Explain when Tailscale uses a
direct non-loopback listener and when a local forward preserves loopback
binding. Do not present Mosh as an HTTP tunnel.

Verification:

- Complete authenticated WebSocket sessions through an SSH port forward, a
  private tailnet path, and one supported reverse proxy.
- Confirm authentication and origin checks remain active on every path.
- Check every documented command from a clean environment.

Deliverable exit: Pau runs as a local or explicitly secured remote web service
without Tauri. The web app covers server-backed workflows, reports unavailable
native capabilities honestly, and does not depend on the desktop route tree.
