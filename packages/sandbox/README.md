# Pau sandbox

This private package runs Pi's built-in tools inside an operating-system
sandbox while Pi and its model credentials stay outside it. It uses the pinned
`@anthropic-ai/sandbox-runtime` release: Bubblewrap on Linux and Seatbelt on
macOS.

Pau resolves the policy in Rust (`pau-core::sandbox`) and writes it to a policy
file. This package only reads that file. It contains:

- `src/policy.ts`: reads and validates the policy file and classifies a change
  as a network update or a tool host restart
- `src/launcher.ts`: starts the sandbox, proves it with a no-op command, and
  refuses to run anything when that fails
- `src/credential-broker.ts`: owns one trusted broker process per session and
  sends real credential values to it through a private startup pipe
- `src/credential-broker-process.ts`: retains credential mappings in memory and
  exposes only per-session sentinels to the sandbox launcher
- `src/credential-proxy.ts`: limits each sentinel to its configured TLS hosts
  and ports, then registers it with sandbox-runtime's terminating proxy
- `src/pi-extension.ts`: replaces Pi's `read`, `bash`, `edit`, `write`,
  `grep`, `find`, and `ls` tools and operator `!` commands with calls to the
  tool host, blocks every other tool, and asks before each call to a tool the
  operator enabled outside the sandbox
- `native/denial-preload`: builds the Linux `LD_PRELOAD` library that observes
  denied file and connection calls without changing the kernel result
- `src/preload.ts`: loads bounded, versioned Linux denial reports from the
  tool host and its descendants
- `src/seatbelt.ts`: reads attributed macOS Seatbelt denial reports from
  unified logging
- `src/denials.ts`: compares the paths a failed tool call names with the
  policy and tells the model what the sandbox blocked
- `src/sandbox-session.ts`: applies policy file changes and restarts the tool
  host between tool calls when filesystem access changes
- `src/tool-host.ts`: runs those tools and contained stdio MCP servers inside
  the sandbox
- `src/mcp-relay.ts`: serves each contained MCP server on the Unix socket that
  `pi-mcp-adapter` connects to

Pau loads the extension and names the policy file in `PAU_SANDBOX_POLICY_FILE`:

```sh
PAU_SANDBOX_POLICY_FILE=/path/to/session/host/policy.json \
  pi --extension packages/sandbox/src/pi-extension.ts
```

When the session starts, the extension starts the tool host and sets the
`pau.sandbox` extension status to `{"state":"ready"}`, or to
`{"state":"unavailable","message":…}` with the reason. Pau waits for that record
before it reports a sandboxed session as started, stops Pi when it reports
`unavailable` or never arrives, and does not show the record in the session.

## Credential references

A sandbox profile can reference a tool credential by its host environment
variable and list the TLS destinations that may receive it. Each reference uses
one reviewed value shape:

- `whole-value` replaces the complete value.
- `url-password` replaces the password in
  `scheme://user:password@host` syntax.
- `colon-pair` replaces everything after the first colon in a
  `name:credential` pair.

Pau rejects unknown shapes and values that do not match the selected shape. It
never forwards the raw value as a fallback. Persisted settings and the effective
sandbox description contain the reference and shape, not the value. Model
provider credentials and MCP OAuth credentials remain in their native hosts and
stores.

Credential files remain unreadable in both initial cross-platform profiles.
For each reference, Pau places an unguessable per-session sentinel under the
source variable's name in the tool environment. The real value crosses only
the trusted broker's startup pipe and remains in that process's memory. Stopping
the session clears the broker's mapping and ends the process.

The sentinel is not usable as a credential by itself. The egress proxy
substitutes it in request headers and bodies only after it terminates TLS,
checks the configured host and port, resolves the destination through the
sandbox network policy, and verifies the upstream certificate. Plain HTTP,
SOCKS-only traffic, excluded TLS hosts, certificate-pinned clients, and mTLS
connections receive the sentinel or fail instead of receiving the real value.
Pau never retries a failed proxy request outside the sandbox. A permitted
destination can use the credential on the operator's behalf or return it in a
response that the sandboxed tool can read.

When a profile brokers whole-value `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` variables, Pau registers the pair with sandbox-runtime's
reviewed AWS Signature Version 4 (SigV4) re-signing path. An optional brokered
`AWS_SESSION_TOKEN` joins the pair. Header-signed SigV4 requests are re-signed
only for the access key's configured destinations. Streaming signatures,
presigned URLs, and SigV4a fail closed because Pau keeps sandbox-runtime's
default denial policy for those forms.

## Run the tests

`pnpm --filter @stormlightlabs/pau-sandbox test` checks credential destination
matching and substitution, denial reports against a policy from the Rust
resolver, and the Linux and macOS report parsers. It needs no sandbox
executables.

## Run the fixtures

Linux needs `bwrap`, `socat`, and `rg` on `PATH`. The Nix development shell
provides them. The fixtures build Pau's `sandbox-policy` resolver with Cargo on
first use. Set `PAU_SANDBOX_POLICY_BIN` to a built resolver to skip that step.
Each run creates a temporary fixture, prints one line per check, and exits
non-zero when a check fails. Neither calls a model provider or the network.

```sh
pnpm --filter @stormlightlabs/pau-sandbox test:boundary
pnpm --filter @stormlightlabs/pau-sandbox test:seatbelt
pnpm --filter @stormlightlabs/pau-sandbox test:pi
```

`test:boundary` runs file, credential, protected-configuration, symlink,
network, socket, environment, subprocess, placeholder, cleanup, terminal, and
startup-failure cases against each profile. It also checks live network
changes and pinned executables. Descendant teardown and Bubblewrap placeholder
checks run only on Linux. The macOS PTY check remains skipped until the
sandboxed terminal relay exists. `test:seatbelt` runs on macOS and checks denied
file and direct TCP access from a sandboxed process and its descendants.
`test:pi` starts Pi in RPC mode with a scripted model and checks every built-in
tool through the sandbox, including streaming, abort, timeout, truncation,
tool host crashes, grant changes during a session, a contained stdio MCP
server, and per-call approval.
