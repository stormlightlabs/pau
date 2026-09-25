# Pau

Pau is a local-first desktop and web application for running coding-agent
sessions across projects. Pi is the primary agent. Claude Code, Codex, and
Antigravity can be added through process adapters.

The name references
[xkcd 1292, “Pi vs. Tau”](https://www.explainxkcd.com/wiki/index.php/1292:_Pi_vs._Tau).

The application is planned around:

- Tauri 2 for the desktop shell
- SvelteKit for the interface
- Axum for the local API, WebSocket event stream, and web server
- Rust process and PTY supervision
- Pi's RPC protocol for structured session control
- Neovim's embedded RPC UI, with CodeMirror as a lightweight editor

The repository contains the workspace scaffold for the web app, desktop shell,
documentation site, shared packages, and Rust services. See
[SPEC.md](dev/SPEC.md), [PLAN.md](dev/PLAN.md), and
[ROADMAP.md](dev/ROADMAP.md).

## Development environment

The Nix flake supports x86-64 and ARM64 Linux plus Apple Silicon macOS. Enter it
directly:

```sh
nix develop
```

For automatic activation with direnv:

```sh
direnv allow
```

The shell provides Rust, Node.js, pnpm, SQLite, Neovim, and the native Linux
libraries required by Tauri. macOS builds still require Xcode Command Line
Tools.

Install dependencies and run the workspace checks from the repository root:

```sh
pnpm install
pnpm format:check
pnpm check
cargo check --workspace
```

Build the documentation site and Pagefind index:

```sh
pnpm build:website
```

Start the component workbench for shared UI development:

```sh
pnpm dev:ui
```

Run its browser tests or build the static workbench:

```sh
pnpm test:ui
pnpm build:ui
```

When a Rust wire type changes, update the checked TypeScript contract:

```sh
pnpm generate:protocol
```

## Pi installation

Pau discovers Pi from a configured executable path or `PATH`. The current
compatibility floor is Pi 0.87.1. Install it globally with npm if `pi --version`
does not report a supported release:

```sh
npm install --global @earendil-works/pi-coding-agent
pi --version
```

Discovery checks the version without starting a session. It reports Pi's user
configuration under `PI_CODING_AGENT_DIR` or `~/.pi/agent`, project
configuration under `<workspace>/.pi`, and session storage under
`PI_CODING_AGENT_SESSION_DIR` or the user configuration directory.

## Run the local application

For browser development, generate a token with `openssl rand -hex 32`. Set
`PAU_API_TOKEN` to that value in both terminals, then start the local API and
web app:

```sh
PAU_API_TOKEN="$TOKEN" cargo run -p pau-server
PAU_API_TOKEN="$TOKEN" pnpm --filter @stormlightlabs/pau-web dev
```

The development server authenticates and forwards `/api` requests to the local
API at `127.0.0.1:3001`. The `/api/health`, `/api/version`, and `/api/events`
endpoints reject requests without the launch token.

To run the desktop app, use the Tauri development command:

```sh
pnpm --filter @stormlightlabs/pau-desktop dev
```

Tauri generates a new API token, starts the API on an unused loopback port, and
passes the token to its webview. It stops the API when the app exits. The
desktop app loads the same SvelteKit static build used by the browser. API logs
record authentication failures without recording supplied credentials.

## Product principles

- Keep agent processes visible and interruptible.
- Preserve each agent's native session format instead of inventing a second
  transcript format.
- Put protocol-specific behavior behind small adapters.
- Use the same backend and frontend in desktop and browser modes.
- Treat local command execution as privileged access, especially in browser
  mode.
- Ship useful vertical slices before adding dashboards, agent councils, or
  workflow builders.

## License

Pau is available under either the MIT License or the Apache License 2.0.
