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
- editor command-line interfaces for external workspace, file, location, and
  diff launch
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

## Editor dependency selection

Use CodeMirror 6 for Pau's built-in file, quick-edit, and diff surfaces. The
initial editor uses `codemirror` 6.0.2 with `@codemirror/state` 6.7.6,
`@codemirror/language` 6.12.4, `@codemirror/language-data` 6.5.2, and
`@lezer/highlight` 1.2.4. The language catalog matches filenames and loads its
native and legacy language packages on demand. Keep language services behind an
optional backend supervisor rather than adding a browser language-server
runtime.

External editor launch uses each editor's documented command-line interface and
Rust process APIs. It does not require an editor plugin or a shared editor
protocol. Keep known argument mappings for Neovim, Vim, Helix, Visual Studio
Code, and Zed, and allow an explicit command template for another editor.
Terminal editors run through the selected PTY and xterm.js stack.

Do not add a Neovim RPC client or browser grid renderer in the first release. A
previous spike proved that `nvim --embed` can provide redraw, input, and resize,
but a complete integration also owns rendering, multigrid, clipboard, input,
configuration, theming, version compatibility, and reconnect behavior. Revisit
those dependencies only if deep embedding becomes a separate product priority.
