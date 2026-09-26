# Dependency policy

Use maintained libraries for protocol, terminal, editor, and rendering work
before writing equivalents. Prefer small libraries with stable wire or platform
boundaries over adopting an IDE framework. Use Valibot for TypeScript runtime
schema validation unless an integration requires another validator. Record the
version, license, maintenance state, and the missing requirement that justifies
any custom implementation.

The initial choices to validate are:

- `@xterm/xterm` and official addons for terminal emulation, fitting, search,
  serialization, links, clipboard, Unicode, and optional WebGL rendering
- `portable-pty` for Rust PTY ownership on Linux and macOS
- CodeMirror 6 for lightweight editing and diff views
- `nvim-rs` or another maintained Rust client for Neovim msgpack-RPC
- an existing embeddable Neovim web UI or grid renderer, if one meets current
  Neovim UI protocol, input, theming, and reconnect requirements
- Iconify through UnoCSS or unplugin for the selected icon sets

## Terminal dependency selection

Use `portable-pty` 0.9.0 for PTY ownership. The crate is MIT-licensed and is
maintained in the WezTerm repository. Its native Unix backend supports Linux
and macOS through the same API. PTY reads, writes, child waits, and process
control are blocking, so `pau-term` must keep them off Tokio worker threads.
The spike exercised Linux. A macOS run is still required before this selection
is final.

Use `@xterm/xterm` 6.0.0 with these official MIT-licensed addons from the
xterm.js repository:

- `@xterm/addon-fit` 0.11.0
- `@xterm/addon-search` 0.16.0
- `@xterm/addon-serialize` 0.14.0
- `@xterm/addon-unicode11` 0.9.0
- `@xterm/addon-web-links` 0.12.0
- `@xterm/addon-clipboard` 0.2.0

The Unicode 11 addon uses xterm.js's proposed API and requires
`allowProposedApi`. Fit requires a visible, measured container. Clipboard
access depends on browser permissions and a secure context. Serialization
captures emulator state but does not replace backend scrollback. Web links
need Pau's own allowlist and click handler before they can navigate.

Binary WebSocket frames carry PTY input and output without converting output
to text. Browser text input is UTF-8 encoded, while xterm.js binary events keep
their byte values. Text WebSocket frames carry typed controls such as resize.
The spike keeps the PTY alive across browser reconnects, but a detached client
receives only new output. `pau-term` must provide session ownership, bounded
scrollback and replay, backpressure, staged shutdown, and control validation.
No custom terminal parser, emulator, or PTY layer is justified.

Use `nvim-rs` 0.9.2 with its Tokio support for Neovim msgpack-RPC. The crate is
LGPL-3.0-licensed, supports child-process transports and nested asynchronous
requests, and remains maintained. Its API is unstable, so keep it inside
`pau-term` and do not expose its types in Pau's protocol. `neovim-lib` 0.6.1 is
also LGPL-3.0-licensed, but its repository has been inactive since 2019 and its
synchronous API is a worse fit for the Tokio backend. The spike attached to
Neovim 0.12.5 through `nvim --embed`, received line-grid redraws, sent input,
and resized the external UI.

No existing browser renderer meets Pau's requirements. `neovim-component`
0.10.1 is MIT-licensed, but its last release was in 2017 and it depends on
Polymer 2, Electron or Node process access, and the old Neovim UI protocol.
Firenvim is maintained and renders Neovim in Chromium and Firefox, but it is a
GPL-3.0 browser extension and Neovim plugin rather than an embeddable renderer.
Its renderer depends on Firenvim's native-messaging transport and page takeover
lifecycle.

Pau will own a thin browser grid and input layer behind the renderer interface.
The base layer handles `grid_resize`, `grid_clear`, `grid_line`, `grid_scroll`,
`grid_cursor_goto`, highlight definitions, mode changes, and `flush`. It maps
keyboard, mouse, focus, paste, clipboard, and measured container size to typed
backend controls. Rust owns process and RPC lifecycle and translates raw redraw
batches to compact WebSocket events. The browser uses platform text measurement
and rendering; Pau will not implement msgpack-RPC or a text-shaping engine.
Multigrid placement, floating windows, external messages, command lines, popup
menus, tablines, and wildmenus remain unsupported until the later multigrid
work.
