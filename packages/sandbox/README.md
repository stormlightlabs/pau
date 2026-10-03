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

## Credential references

A sandbox profile can reference a tool credential by its host environment
variable and list the TLS destinations that may receive it. Pau validates the
variable name and confirms that the variable has a nonempty value when it
resolves the profile. Persisted settings and the effective sandbox description
contain the reference, not the value. Model provider credentials and MCP OAuth
credentials remain in their native hosts and stores.

Credential files remain unreadable in both initial cross-platform profiles.
For each reference, Pau places an unguessable per-session sentinel under the
source variable's name in the tool environment. The real value crosses only
the trusted broker's startup pipe and remains in that process's memory. Stopping
the session clears the broker's mapping and ends the process.

The sentinel is not usable as a credential by itself. A later egress-proxy
layer substitutes it only for configured TLS destinations. Until that layer is
active, requests that send the sentinel cannot authenticate.

## Run the tests

`pnpm --filter @stormlightlabs/pau-sandbox test` checks denial reports against
a policy from the Rust resolver and validates the Linux and macOS report
parsers. It needs no sandbox executables.

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

See [backend contracts](../../dev/plan/backend.md#sandbox-runtime-selection)
for the measured guarantees and known gaps.
