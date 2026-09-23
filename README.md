# Pau

Pau is a local-first desktop and web application for running coding-agent sessions across projects. Pi is the primary agent. Claude Code, Codex, and Antigravity can be added through process adapters.

The name references [xkcd 1292, “Pi vs. Tau”](https://www.explainxkcd.com/wiki/index.php/1292:_Pi_vs._Tau).

The application is planned around:

- Tauri 2 for the desktop shell
- SvelteKit for the interface
- Axum for the local API, WebSocket event stream, and web server
- Rust process and PTY supervision
- Pi's RPC protocol for structured session control
- Neovim's embedded RPC UI, with CodeMirror as a lightweight editor

The repository is currently in the design stage. See [SPEC.md](dev/SPEC.md), [PLAN.md](dev/PLAN.md), and [ROADMAP.md](dev/ROADMAP.md).

## Development environment

The Nix flake supports x86-64 and ARM64 Linux plus Apple Silicon macOS. Enter it directly:

```sh
nix develop
```

For automatic activation with direnv:

```sh
direnv allow
```

The shell provides Rust, Node.js, pnpm, SQLite, Neovim, and the native Linux libraries required by Tauri. macOS builds still require Xcode Command Line Tools.

## Product principles

- Keep agent processes visible and interruptible.
- Preserve each agent's native session format instead of inventing a second transcript format.
- Put protocol-specific behavior behind small adapters.
- Use the same backend and frontend in desktop and browser modes.
- Treat local command execution as privileged access, especially in browser mode.
- Ship useful vertical slices before adding dashboards, agent councils, or workflow builders.

## License

Pau is available under either the MIT License or the Apache License 2.0.
