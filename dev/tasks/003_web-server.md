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

## 3.2 Standalone server process survival

Status: planned
Blocked by: 3.1

Apply the desktop process-survival contract to the standalone server. Keep
agents and terminals alive when every remote browser disconnects.

Verification:

- Disconnect all browsers while each process type is active and reconnect.

## 3.7 Standalone server shutdown

Status: planned
Blocked by: 3.2

Stop agents and terminals in order when the standalone server shuts down.

Verification:

- Send server termination signals during active work and confirm bounded cleanup.

## 3.8 Standalone server restart recovery

Status: planned
Blocked by: 3.2

Apply the desktop restart-recovery contract to the standalone server.

Verification:

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

## 3.4 Non-loopback startup gate

Status: planned
Blocked by: 3.1

Require an explicit flag and durable authentication configuration before binding
to a non-loopback address. Enforce secure cookie or bearer-token handling.

Verification:

- Refuse unsafe non-loopback startup combinations.
- Test expired credentials, logout, and WebSocket authentication.

## 3.9 Origin checks

Status: planned
Blocked by: 3.4

Enforce origin checks on HTTP and WebSocket requests. Keep them active on
private tailnets.

Verification:

- Test allowed and denied origins for HTTP and WebSocket requests.

## 3.5 Remote session expiry

Status: planned
Blocked by: 3.4

Expire remote sessions after an idle period and after an absolute lifetime.

Verification:

- Test idle and absolute expiry.

## 3.10 Remote credential rotation

Status: planned
Blocked by: 3.4

Rotate the server's authentication keys.

Verification:

- Test key rotation with existing sessions.

## 3.11 Authentication rate limits

Status: planned
Blocked by: 3.4

Rate-limit authentication attempts.

Verification:

- Test rate-limit enforcement and recovery.

## 3.12 Remote audit events

Status: planned
Blocked by: 3.4

Extend the shared mutation audit with remote identity, authentication, and
session-lifecycle events.

Verification:

- Cover each event type and confirm command secrets are redacted from audit
  output.

## 3.6 Remote access guide

Status: planned
Blocked by: 3.5, 3.9, 3.10, 3.11, 3.12

Document loopback SSH port forwarding and Tailscale access. Explain the
difference between loopback port forwarding and direct tailnet binding, and
when Tailscale uses a direct non-loopback listener. Do not present Mosh as an
HTTP tunnel.

Verification:

- Complete authenticated WebSocket sessions through an SSH port forward and a
  private tailnet path.
- Confirm authentication and origin checks remain active on each path.
- Check every documented command from a clean environment.

## 3.13 Reverse-proxy deployment guide

Status: planned
Blocked by: 3.5, 3.9, 3.10, 3.11, 3.12

Document TLS termination, WebSocket forwarding, trusted proxy settings, data
directories, backups, and the server account's command-execution privileges.

Verification:

- Complete an authenticated WebSocket session through one supported reverse
  proxy.
- Confirm authentication and origin checks remain active.
- Check every documented command from a clean environment.

Deliverable exit: Pau runs as a local or explicitly secured remote web service
without Tauri. The web app covers server-backed workflows, reports unavailable
native capabilities honestly, and does not depend on the desktop route tree.
