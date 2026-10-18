# Backlog

## Verification backlog

Run the resource-monitoring sampler smoke test on macOS when a runner is
available.

Run the `pau-term` PTY tests on Linux.

Make the `pau-pi` test `escalates_shutdown_from_interrupt_to_terminate`
reliable under build load. It passes alone but fails occasionally while other
Cargo builds run.

Find what moves the transcript's scroll position during a re-render, then make
`SessionViewFollow.svelte.test.ts` reliable. The test "stops following after
the user scrolls up and resumes at the bottom" fails occasionally in the full
`packages/ui` suite. When `settled()` also waits for a task, so the test's
updates arrive as app updates do, "stays at the bottom while output streams"
fails every time. Growing the transcript from 30 to 40 entries moves
`scrollTop` from the bottom (5098) to 4913 with no removed nodes, and the scroll
event for that move turns following off. If this happens with live output,
follow mode drops while a reply streams.

Make the `SessionView.stories.ts` story "Model Without Image Input" reliable. It
fails occasionally with a `TestingLibraryElementError` when the full
`packages/ui` suite runs alongside other test runs, and passes alone.

Run the `packages/sandbox` boundary and Pi fixture runs on macOS before Pau
offers a sandbox profile there. Run the boundary fixtures on an Ubuntu 24.04
host with AppArmor's unprivileged user-namespace restriction enabled to confirm
the startup failure seen with a simulated `bwrap`.

Add a Nix-built Docker image that runs the `packages/sandbox` unit tests,
boundary fixtures, and Pi fixtures under Bubblewrap, so Linux sandbox behavior
can be checked from a macOS development machine. Use it to confirm credential
substitution with common bearer-token, URL-password, and colon-pair values,
denial reports for failed tool calls, and the ripgrep wrapper's skipped-file
report on Linux.

## Research backlog

### Remote execution

Running the web server on an operator-configured remote host remains part of
3.6. Automatic setup or control of another machine from the desktop app is not
planned. Research these questions before assigning remote execution to a
deliverable:

- Choose between installing Pau on the remote host and carrying Pau protocols
  over an SSH-managed transport. Define the trust boundary for each topology.
- Specify host-key verification, authentication bootstrap, jump-host support,
  connection sharing, Tailscale use, and recovery after a network change. Check
  where Mosh helps terminal sessions and where it cannot carry HTTP or
  WebSocket traffic.
- Define installation, version negotiation, upgrades, rollback, and compatibility
  between the desktop app, remote server, adapters, and stored state.
- Define ownership across disconnects, desktop exit, remote restart, duplicate
  clients, and partial startup. Include orphan detection and resumability.
- Prototype remote workspace discovery, path identity, file watching, symlinks,
  permissions, large transfers, and conflict behavior on high-latency links.
- Prototype PTY reconnect and resize, signal delivery, clipboard behavior, and
  forwarding for development servers without exposing arbitrary remote ports.
- Decide where agent, MCP, Git, and command credentials live. Cover forwarding,
  revocation, redaction, audit identity, and compromise of either machine.
- Compare direct host processes, a service manager, rootless containers, and an
  optional Docker or Podman deployment. Test user IDs, mounted workspaces,
  resource accounting, and nested local sandboxes before treating a container
  as an isolation boundary.
- Define the supported remote operating systems and test network loss, sleep,
  host replacement, clock skew, low disk space, and protocol downgrade.

The research must produce a threat model, one recommended topology, a small
end-to-end prototype, and explicit deferred cases before implementation starts.

Deep browser embedding for Neovim or another editor, a Kickstart-based Neovim
profile, `.deb` and RPM packages, Intel macOS, signing and notarization
automation, shared workspaces, agent councils, workflow graphs, mobile clients,
and extension marketplaces remain backlog items.

Cloud sandboxes and hosted execution are not planned.

## Parking Lot

- We don't need an h1 (`#`) on svx pages (it makes the title redundant)
