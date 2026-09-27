# Pau sandbox

This private package runs Pi's built-in tools inside an operating-system
sandbox while Pi and its model credentials stay outside it. It uses the pinned
`@anthropic-ai/sandbox-runtime` release: Bubblewrap on Linux and Seatbelt on
macOS.

The package contains:

- `src/profile.ts`: translates Pau's workspace-write and read-only profiles
  into a sandbox-runtime policy and builds the tool environment
- `src/launcher.ts`: starts the sandbox, proves it with a no-op command, and
  refuses to run anything when that fails
- `src/pi-extension.ts`: replaces Pi's `read`, `bash`, `edit`, `write`,
  `grep`, `find`, and `ls` tools and operator `!` commands with calls to the
  tool host, and blocks every other tool
- `src/tool-host.ts`: runs those tools inside the sandbox

Load the extension with the policy in `PAU_SANDBOX_POLICY`:

```sh
PAU_SANDBOX_POLICY='{"profile":"workspace-write","workspace":"/path/to/repo","tempDir":"/path/to/session-tmp","home":"/home/me"}' \
  pi --extension packages/sandbox/src/pi-extension.ts
```

## Run the fixtures

Linux needs `bwrap`, `socat`, and `rg` on `PATH`. The Nix development shell
provides them. Both runs create a temporary fixture, print one line per check,
and exit non-zero when a check fails. Neither calls a model provider or the
network.

```sh
pnpm --filter @stormlightlabs/pau-sandbox test:boundary
pnpm --filter @stormlightlabs/pau-sandbox test:pi
```

`test:boundary` runs file, credential, protected-configuration, symlink,
network, socket, environment, subprocess, cleanup, terminal, and startup-failure
cases against each profile. `test:pi` starts Pi in RPC mode with a scripted
model and checks every built-in tool through the sandbox.

See [backend contracts](../../dev/plan/backend.md#sandbox-runtime-selection)
for the measured guarantees and known gaps.
